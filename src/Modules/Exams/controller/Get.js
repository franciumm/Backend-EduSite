
import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import { pagination } from "../../../utils/pagination.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime } from 'date-fns-tz';
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";
import { canViewSubmissionsFor } from "../../../middelwares/contentAuth.js";



export const getExams = asyncHandler(async (req, res, next) => {
  const { gradeId, groupId, page, size } = req.query; // <-- 2. GET PAGE AND SIZE
    const isTeacher = req.isteacher;
    const uaeTimeZone = 'Asia/Dubai';
    const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
  const { limit, skip } = pagination({ page, size });

    // --- Teacher logic remains the same, they don't need complex aggregation ---
    if (isTeacher) {
        let query = {};
        if (req.user.role === 'main_teacher') {
            if (gradeId) query.grade = gradeId;
            if (groupId) query.groupIds = groupId;
        } else if (req.user.role === 'assistant') {
            const groupIds = req.user.permissions.exams || [];
            if (groupIds.length === 0) return res.status(200).json({ message: "No exams found.", data: [] });
            query = { groupIds: { $in: groupIds } };
        }
        const exams = await examModel
        .find(query)
        .skip(skip) // <-- 3. APPLY PAGINATION
        .limit(limit)
        .lean();
        return res.status(200).json({ message: "Exams fetched successfully", exams: exams });
    }

    // --- Student Logic (Rewritten with Aggregation Pipeline) ---

       const streamItems = await contentStreamModel.find({
        userId: req.user._id,
        contentType: 'exam'
    }).lean();
 const examIds = streamItems.map(item => item.contentId);
    if (examIds.length === 0) {
        return res.status(200).json({ message: "No exams found.", data: [] });
    }
    const allExams = await examModel.find({ _id: { $in: examIds } }).lean();
  const visibleExams = allExams.filter(exam => {
        const exception = (exam.exceptionStudents || []).find(ex => ex.studentId.equals(req.user._id));
        const effectiveStartDate = exception ? exception.startdate : exam.startdate;
        return new Date(effectiveStartDate) <= nowInUAE;
    });
        const paginatedExams = visibleExams.slice(skip, skip + limit);
 const sanitizedExams = paginatedExams.map(exam => ({
        ...exam,
        key: undefined,
        bucketName: undefined,
        answerKey: undefined,
        answerBucketName: undefined,
        answerPath: undefined,
        exceptionStudents: undefined, // Students don't need to see the exception list
    }));


   
    res.status(200).json({
        message: "Exams fetched successfully",
        data: sanitizedExams,
    });
});



// --- Corrected and Improved Controller ---
export const getSubmittedExams = asyncHandler(async (req, res, next) => {
  const { groupId, examId, studentId, gradeId, status, page = 1, size = 10 } = req.query;
  const { user, isteacher } = req;
  const isTeacher = isteacher;
  const uaeTimeZone = 'Asia/Dubai';
  const currentDate = toZonedTime(new Date(), uaeTimeZone);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limit = Math.max(1, parseInt(size, 10) || 10);
  const skip = (pageNum - 1) * limit;

  
 
  const empty = (msg = "Submissions fetched successfully.") =>
    res.status(200).json({ message: msg, total: 0, totalPages: 0, currentPage: pageNum, data: [] });

  // ================================ Teacher Logic ================================ //
  if (isTeacher) {
    // ------ Path A: Exam-Centric Student Status View (when examId provided) ------
    if (examId) {
      if (!mongoose.Types.ObjectId.isValid(examId)) return next(new Error("Invalid Exam ID format.", { cause: 400 }));

      const exam = await examModel.findById(examId).lean();
      if (!exam) return next(new Error("Exam not found.", { cause: 404 }));
         const hasAccess = await canViewSubmissionsFor({ user, isTeacher: true, contentId: examId, contentType: 'exam' });
            if (!hasAccess) {
                return next(new Error("You are not authorized to view submissions for this exam.", { cause: 403 }));
            }

             const studentCountQuery = {};
            if (groupId) {
                 studentCountQuery.groupId = new mongoose.Types.ObjectId(groupId);
            } else {
                 studentCountQuery.groupId = { $in: exam.groupIds };
            }
            const total = await studentModel.countDocuments(studentCountQuery);
  let statusQuery = { contentId: examId, contentType: 'exam', ...studentCountQuery };
            if (status && ['submitted', 'not submitted', 'marked'].includes(status)) {
                const statusMap = { 'submitted': 'submitted', 'not submitted': 'assigned', 'marked': 'marked' };
                statusQuery.status = statusMap[status];
            }

 const statuses = await submissionStatusModel.find(statusQuery)
                .populate('studentId', '_id userName firstName lastName')
                .populate({ path: 'submissionId', model: 'subexam' }) // Explicitly model 'subexam'
                .sort({ 'studentId.firstName': 1 })
                .skip(skip).limit(limit)
                .lean();

const data = statuses.map(s => ({
                _id: s.studentId._id,
                userName: s.studentId.userName,
                firstName: s.studentId.firstName,
                lastName: s.studentId.lastName,
                status: s.status === 'assigned' ? 'not submitted' : s.status,
                submissions: s.submissionId ? [s.submissionId] : [], // Mimic original array structure
                submissionCount: s.submissionId ? 1 : 0,
            }));


      return res.status(200).json({
        message: "Submissions fetched successfully.",
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: pageNum,
        data
      });
    }

    // ------ Path B: General Submission List (no examId) ------
    const matchStage = {};

    if (user.role === 'assistant') {
      const permitted = (user.permissions.exams || []).map(id =>
        typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
      );
      if (permitted.length === 0) return empty();
      matchStage['examData.groupIds'] = { $in: permitted };
    }
    
    if (groupId) matchStage['examData.groupIds'] = new mongoose.Types.ObjectId(groupId);
    if (gradeId) matchStage['examData.grade'] = new mongoose.Types.ObjectId(gradeId);
    if (studentId) matchStage.studentId = new mongoose.Types.ObjectId(studentId);

    if (status === 'active') {
      matchStage['examData.startdate'] = { $lte: currentDate };
      matchStage['examData.enddate'] = { $gte: currentDate };
    } else if (status === 'upcoming') {
      matchStage['examData.startdate'] = { $gt: currentDate };
    } else if (status === 'expired') {
      matchStage['examData.enddate'] = { $lt: currentDate };
    }

    const basePipeline = [
      { $lookup: { from: 'exams', localField: 'examId', foreignField: '_id', as: 'examData' } },
      { $unwind: '$examData' },
      { $match: matchStage },
      { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'studentData' } },
      { $unwind: '$studentData' }
    ];

    const [{ total = 0 } = {}] = await SubexamModel.aggregate([...basePipeline, { $count: 'total' }]);
    if (total === 0) return empty();

    const data = await SubexamModel.aggregate([
      ...basePipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          annotationData: 1,
          _id: 1,
          createdAt: 1,
          updatedAt: 1,
          score: 1,
          notes: 1,
          fileBucket: 1,
          fileKey: 1,
          filePath: 1,
          teacherFeedback: 1,
          examId: {
            _id: '$examData._id',
            Name: '$examData.Name',
            startdate: '$examData.startdate',
            enddate: '$examData.enddate'
          },
          studentId: {
            _id: '$studentData._id',
            userName: '$studentData.userName',
            firstName: '$studentData.firstName',
            lastName: '$studentData.lastName'
          }
        }
      }
    ]);

    return res.status(200).json({
      message: "Submissions fetched successfully.",
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: pageNum,
      data
    });
  }

  // =============================== Student Logic =============================== //
  const studentPipeline = [
    { $match: { studentId: user._id } },
    { $lookup: { from: 'exams', localField: 'examId', foreignField: '_id', as: 'examData' } },
    { $unwind: '$examData' },
    {
      $addFields: {
        exceptionEntry: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$examData.exceptionStudents',
                as: 'ex',
                cond: { $eq: ['$$ex.studentId', user._id] }
              }
            },
            0
          ]
        }
      }
    },
    {
      $addFields: {
        effectiveStartDate: { $ifNull: ['$exceptionEntry.startdate', '$examData.startdate'] },
        effectiveEndDate: { $ifNull: ['$exceptionEntry.enddate', '$examData.enddate'] }
      }
    }
  ];

  if (status) {
    const statusMatch = {};
    if (status === 'active') {
      statusMatch.effectiveStartDate = { $lte: currentDate };
      statusMatch.effectiveEndDate = { $gte: currentDate };
    } else if (status === 'upcoming') {
      statusMatch.effectiveStartDate = { $gt: currentDate };
    } else if (status === 'expired') {
      statusMatch.effectiveEndDate = { $lt: currentDate };
    }
    if (Object.keys(statusMatch).length) studentPipeline.push({ $match: statusMatch });
  }

  const [{ total = 0 } = {}] = await SubexamModel.aggregate([...studentPipeline, { $count: 'total' }]);
  if (total === 0) {
    return res.status(200).json({
      message: "Submissions fetched successfully.",
      total: 0,
      totalPages: 0,
      currentPage: pageNum,
      data: []
    });
  }

  const data = await SubexamModel.aggregate([
    ...studentPipeline,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        annotationData: 1,
        _id: 1,
        createdAt: 1,
        updatedAt: 1,
        score: 1,
        notes: 1,
        fileBucket: 1,
        fileKey: 1,
        filePath: 1,
        teacherFeedback: 1,
        examId: {
          _id: '$examData._id',
          Name: '$examData.Name',
          startdate: '$examData.startdate',
          enddate: '$examData.enddate'
        }
      }
    }
  ]);

  return res.status(200).json({
    message: "Submissions fetched successfully.",
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: pageNum,
    data: data.map(s => ({ ...s, studentId: user }))
  });
});


export const  getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
  const { groupId, examId, status, page = 1, size = 10 } = req.query;
    const { user } = req; // Added user from req
// 1) Validate groupId - Common for both scenarios
  if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
    return next(new Error("A valid Group ID is required", { cause: 400 }));
  }  if (user.role === 'assistant') {
        const permittedGroupIds = user.permissions.exams?.map(id => id.toString()) || [];
        if (!permittedGroupIds.includes(groupId)) {
            return next(new Error("Forbidden: You do not have permission to access submissions for this group.", { cause: 403 }));
        }
    }
  const gId = new mongoose.Types.ObjectId(groupId);

  // Pagination helpers - Common for both scenarios
  const pg = parseInt(page, 10);
  const { limit, skip } = pagination({ page: pg, size: parseInt(size, 10) });

  // --- LOGIC PATH 1: NO EXAM ID (Get all submissions in the group) ---
  if (!examId) {
    const matchQuery = {};
    // Optional status filter on whether the submission has a score
    if (status === "marked") matchQuery.score = { $ne: null };
    else if (status === "unmarked") matchQuery.score = { $eq: null };

    // This pipeline correctly finds submissions by looking up the exam's groupIds
    const pipeline = [
      // Step A: Join subexam with the exams collection
      {
        $lookup: {
          from: "exams", // The actual collection name for exams
          localField: "examId",
          foreignField: "_id",
          as: "exam",
        },
      },
      // Step B: Filter to only include submissions whose exam belongs to the target group
      { $match: { "exam.groupIds": gId } },
      // Step C: Apply optional status filter (marked/unmarked)
      { $match: matchQuery },
    ];
    
    // Execute pipelines for both data and total count
    const [submissions, totalResult] = await Promise.all([
        SubexamModel.aggregate([
            ...pipeline,
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            // Populate student and exam details
            { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'studentId' } },
            { $unwind: '$studentId' },
            { $unwind: '$exam' },
            { $project: { 'studentId.password': 0, 'studentId.otp': 0 } } // Exclude sensitive fields
        ]),
        SubexamModel.aggregate([...pipeline, { $count: "total" }])
    ]);

    const totalSubmissions = totalResult[0]?.total || 0;

    return res.status(200).json({
      message: "All exam submissions for group fetched successfully",
      totalSubmissions,
      totalPages: Math.ceil(totalSubmissions / limit),
      currentPage: pg,
      submissions,
    });
  }

  // --- LOGIC PATH 2: EXAM ID PROVIDED (Get status for every student in group) ---

  // 2) Validate examId
  if (!mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("A valid exam ID is required", { cause: 400 }));
  }
  const eId = new mongoose.Types.ObjectId(examId);

  // 3) Ensure exam exists and is linked to this group (fail-fast)
  const exam = await examModel.findOne({ _id: eId, groupIds: gId }).lean();
  if (!exam) {
    return next(new Error("Exam not found or not assigned to this group", { cause: 404 }));
  }

  // 4) Build the main aggregation pipeline
  // This starts from the group, finds all students, and "left-joins" their submission status
  let aggregationPipeline = [
    // Step A: Start with the specific group
    { $match: { _id: gId } },
    // Step B: Deconstruct the enrolledStudents array to process each student
    { $unwind: "$enrolledStudents" },
    // Step C: Look up full student details
    {
      $lookup: {
        from: "students",
        localField: "enrolledStudents",
        foreignField: "_id",
        as: "studentInfo",
      },
    },
    { $unwind: "$studentInfo" },
    // Step D: The crucial "left join" to find the latest submission for this student and exam
    {
      $lookup: {
        from: "subexams",
        let: { student_id: "$studentInfo._id" },
        pipeline: [
          {
            $match: {
              examId: eId,
              $expr: { $eq: ["$studentId", "$$student_id"] },
            },
          },
          { $sort: { createdAt: -1 } }, // Get the most recent one first
          { $limit: 1 }, // We only care about the latest submission
        ],
        as: "submission",
      },
    },
    // Step E: Unpack the submission (if it exists) while keeping students who didn't submit
    { $unwind: { path: "$submission", preserveNullAndEmptyArrays: true } },
    // Step F: Create the status fields based on whether a submission was found
    {
      $project: {
        _id: "$studentInfo._id",
        userName: "$studentInfo.userName",
        firstName: "$studentInfo.firstName",
        lastName: "$studentInfo.lastName",
        status: { $cond: { if: "$submission", then: "submitted", else: "not submitted" } },
        submittedAt: "$submission.createdAt",
        score: "$submission.score",
        // ADDED a student's notes and a teacher's feedback to the response
        notes: "$submission.notes",
        teacherFeedback: "$submission.teacherFeedback"
      },
    },
  ];

  // 5) Add optional status filter to the pipeline
  if (status === "submitted") {
    aggregationPipeline.push({ $match: { status: "submitted" } });
  } else if (status === "not_submitted") {
    aggregationPipeline.push({ $match: { status: "not submitted" } });
  }

  // 6) Use $facet to get both total count and paginated data in one query
  const results = await groupModel.aggregate([
    ...aggregationPipeline,
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]);

  const students = results[0].data;
  const totalStudents = results[0].metadata[0]?.total || 0;

  res.status(200).json({
    message: "Student submission statuses fetched successfully",
    totalStudents,
    totalPages: Math.ceil(totalStudents / limit),
    currentPage: pg,
    students,
  });
});