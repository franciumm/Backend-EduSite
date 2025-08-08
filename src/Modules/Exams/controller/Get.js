
import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";

import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import { pagination } from "../../../utils/pagination.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime } from 'date-fns-tz';
import { canAccessContent } from "../../../middelwares/contentAuth.js";

export const getExams = asyncHandler(async (req, res, next) => {
    const { gradeId, groupId } = req.query;
    const isTeacher = req.isteacher;
    let query = {};

    // --- Teacher Logic ---
    // Simplified to fetch all matching exams without pagination or status filters.
    if (isTeacher) {
        // Teachers must provide a filter to avoid fetching all exams in the system.
         if (req.user.role === 'main_teacher') {
            if (!gradeId && !groupId) {
                return next(new Error("Query failed: A gradeId or groupId is required for the main teacher.", { cause: 400 }));
            }
            if (gradeId) query.grade = gradeId;
            if (groupId) query.groupIds = groupId;
        } else if (req.user.role === 'assistant') {
            const groupIds = req.user.permissions.exams || [];
            if (groupIds.length === 0) {
                return res.status(200).json({ message: "No exams found.", data: [] });
            }
            query = { groupIds: { $in: groupIds } };
        }
    // --- Student Logic ---
    // This logic is comprehensive, finding all exams a student is eligible for.
    } else {
        const studentId = req.user._id;
        const studentGradeId = req.user.gradeId?.toString();
        const studentGroupId = req.user.groupId?.toString();

        // A student must be in a grade to see any exams.
        if (!studentGradeId) {
            return next(new Error("Unauthorized: You are not associated with any grade.", { cause: 403 }));
        }

        // Authorization check: A student can only query for their own grade.
        if (gradeId && gradeId !== studentGradeId) {
            return next(new Error("Unauthorized: You can only view exams for your own grade.", { cause: 403 }));
        }

        // Base query is always scoped to the student's grade.
        query.grade = studentGradeId;

        // Build a complex $or condition to find all exams visible to the student.
        // A student can see an exam if ANY of the following are true.
        const orConditions = [
            // 1. They are manually enrolled in the exam.
            { enrolledStudents: studentId },
            // 2. They are listed as an exception with a custom timeline.
            { "exceptionStudents.studentId": studentId }
        ];

        // 3. The exam is assigned to their group OR to the entire grade.
        if (studentGroupId) {
            // Exam is for their specific group.
            orConditions.push({ groupIds: studentGroupId });
            // Exam is for the whole grade (i.e., has no group IDs).
            orConditions.push({ groupIds: { $size: 0 } });
        } else {
            // If not in a group, they can only see grade-wide exams.
            orConditions.push({ groupIds: { $size: 0 } });
        }
        
        query.$or = orConditions;
    }

    // Execute a single, powerful query to get all matching documents.
    // .lean() is used for performance as we are only reading data.
    const exams = await examModel.find(query).lean();

    // Respond in the same format as the assignment controller.
    res.status(200).json({
        message: "Exams fetched successfully",
        data: exams,
    });
});
// export const getSubmittedExams = asyncHandler(async (req, res, next) => {
//   const { page = 1, size = 10, groupId, gradeId, status } = req.query;

//   // Extract user details and role
//   const user = req.user;
//   const isTeacher = req.isteacher.teacher;
//   const currentDate = new Date();

//   // Pagination helpers
//   const { limit, skip } = pagination({ page, size });

//   let submissions = [];
//   let totalSubmissions = 0;

//   // 1. Teacher logic
//   if (isTeacher) {
//     // Build a query object
//     const query = {};

//     // Optional filters
//     if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
//       query.groupId = groupId;
//     }
//     if (gradeId && mongoose.Types.ObjectId.isValid(gradeId)) {
//       query.gradeId = gradeId;
//     }

//     // Timeline status (main exam timeline)
//     if (status === "active") {
//       query.startdate = { $lte: currentDate };
//       query.enddate = { $gte: currentDate };
//     } else if (status === "upcoming") {
//       query.startdate = { $gt: currentDate };
//     } else if (status === "expired") {
//       query.enddate = { $lt: currentDate };
//     }

//     // Fetch submissions based on the query
//     submissions = await SubexamModel.find(query)
//       .populate("examId", "Name startdate enddate groupIds grade")
//       .populate("studentId", "userName firstName lastName groupid")
//       .sort({ createdAt: -1 }) // Sort by most recent submission
//       .skip(skip)
//       .limit(limit);

//     totalSubmissions = await SubexamModel.countDocuments(query);
//   } else {
//     // 2. Student logic
//     // Step A: Find all submissions for the student
//     const studentQuery = {
//       studentId: user._id, // Only fetch the submissions by this student
//     };

//     // Fetch submissions
//     let allSubmissions = await SubexamModel.find(studentQuery)
//       .populate("examId", "Name startdate enddate groupIds grade exceptionStudents")
//       .sort({ createdAt: -1 }); // Most recent submissions first

//     // Step B: Filter out based on timeline or exceptions
//     const filteredSubmissions = allSubmissions.filter((submission) => {
//       const exam = submission.examId;

//       // Find custom timeline if the student is an exception
//       const exceptionEntry = exam.exceptionStudents?.find(
//         (ex) => ex.studentId.toString() === user._id.toString()
//       );

//       const examStart = exceptionEntry ? exceptionEntry.startdate : exam.startdate;
//       const examEnd = exceptionEntry ? exceptionEntry.enddate : exam.enddate;

//       if (!status) return true; // If no status, show all

//       if (status === "active") {
//         return examStart <= currentDate && examEnd >= currentDate;
//       } else if (status === "upcoming") {
//         return examStart > currentDate;
//       } else if (status === "expired") {
//         return examEnd < currentDate;
//       }

//       // If no condition matches, exclude
//       return false;
//     });

//     totalSubmissions = filteredSubmissions.length;

//     // Step C: Apply pagination in memory
//     submissions = filteredSubmissions.slice(skip, skip + limit);
//   }

//   // 3. Return the response
//   res.status(200).json({
//     message: "Submitted exams fetched successfully",
//     submissions,
//     totalSubmissions,
//     totalPages: Math.ceil(totalSubmissions / limit),
//     currentPage: parseInt(page, 10),
//   });
// });



// --- Corrected and Improved Controller ---

export const getSubmittedExams = asyncHandler(async (req, res, next) => {
    const { groupId, examId, studentId, gradeId, status, page = 1, size = 10 } = req.query;
    const { user, isteacher } = req;
    const isTeacher = isteacher ;
    const uaeTimeZone = 'Asia/Dubai';
    const currentDate = toZonedTime(new Date(), uaeTimeZone);

    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (pageNum - 1) * limit;

    //================================ Teacher Logic ================================//
    if (isTeacher) {
        
        // --- Path A: Exam-Centric Student Status View ---
        // This unified path is triggered whenever an examId is provided.
        if (examId) {
            if (!mongoose.Types.ObjectId.isValid(examId)) return next(new Error("Invalid Exam ID format.", { cause: 400 }));

            const exam = await examModel.findById(examId).lean();
            if (!exam) return next(new Error("Exam not found.", { cause: 404 }));

            let targetGroupIds = exam.groupIds.map(id => id.toString());

            // --- Assistant Permission Filter ---
            if (user.role === 'assistant') {
                const permittedGroupIds = user.permissions.exams?.map(id => id.toString()) || [];
                targetGroupIds = targetGroupIds.filter(id => permittedGroupIds.includes(id));

                if (targetGroupIds.length === 0) {
                    return res.status(200).json({ message: "You do not have permission to view any groups for this exam.", total: 0, currentPage: 1, totalPages: 1, data: [] });
                }
            }

            // --- Build Student Query based on filters ---
            const studentQuery = { groupId: { $in: targetGroupIds } };

            if (groupId) {
                if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("Invalid Group ID format.", { cause: 400 }));
                if (!targetGroupIds.includes(groupId)) {
                    return res.status(200).json({ message: "The specified group is not part of this exam or you lack permission.", total: 0, currentPage: 1, totalPages: 1, data: [] });
                }
                studentQuery.groupId = groupId; // Further filter students to this specific group.
            }

            if (studentId) {
                if (!mongoose.Types.ObjectId.isValid(studentId)) return next(new Error("Invalid Student ID format.", { cause: 400 }));
                studentQuery._id = studentId; // Pinpoint a single student.
            }

            // --- Fetch Students and Hydrate with Submissions ---
            const [students, total] = await Promise.all([
                studentModel.find(studentQuery).select('_id userName firstName lastName').sort({ firstName: 1 }).skip(skip).limit(limit).lean(),
                studentModel.countDocuments(studentQuery)
            ]);

            let hydratedData = [];
            if (students.length > 0) {
                const studentIdsOnPage = students.map(s => s._id);
                const submissions = await SubexamModel.find({ examId: exam._id, studentId: { $in: studentIdsOnPage } }).sort({ version: -1 }).lean();
                
                const submissionMap = new Map(studentIdsOnPage.map(id => [id.toString(), []]));
                submissions.forEach(sub => submissionMap.get(sub.studentId.toString()).push(sub));

                hydratedData = students.map(student => {
                    const studentSubmissions = submissionMap.get(student._id.toString());
                    return studentSubmissions && studentSubmissions.length > 0
                        ? { _id: student._id, userName: student.userName, firstName: student.firstName, lastName: student.lastName, status: 'submitted', submissionCount: studentSubmissions.length, submissions: studentSubmissions }
                        : { _id: student._id, userName: student.userName, firstName: student.firstName, lastName: student.lastName, status: 'not submitted', submissionCount: 0, submissions: [] };
                });
            }

            if (status && ['submitted', 'not submitted'].includes(status)) {
                hydratedData = hydratedData.filter(s => s.status === status);
            }

            const group = groupId ? await groupModel.findById(groupId).select('groupname').lean() : null;

            return res.status(200).json({
                message: "Student submission statuses fetched successfully.",
                examName: exam.Name,
                groupName: group?.groupname || "Multiple Groups",
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: pageNum,
                data: hydratedData
            });
        }

        // --- Path B: General Submission List (no examId provided) ---
        const matchStage = {};
        
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.exams?.map(id => id.toString()) || [];
            if (permittedGroupIds.length === 0) {
                return res.status(200).json({ message: "You have no permissions to view any submissions.", total: 0, totalPages: 1, currentPage: pageNum, data: [] });
            }
            // Scope query to all permitted groups
            matchStage["examData.groupIds"] = { $in: user.permissions.exams };
        }

        if (groupId) matchStage["examData.groupIds"] = new mongoose.Types.ObjectId(groupId);
        if (gradeId) matchStage["examData.grade"] = new mongoose.Types.ObjectId(gradeId);
        if (studentId) matchStage.studentId = new mongoose.Types.ObjectId(studentId);
        
        if (status === "active") {
            matchStage["examData.startdate"] = { $lte: currentDate };
            matchStage["examData.enddate"] = { $gte: currentDate };
        } else if (status === "upcoming") {
            matchStage["examData.startdate"] = { $gt: currentDate };
        } else if (status === "expired") {
            matchStage["examData.enddate"] = { $lt: currentDate };
        }

        const basePipeline = [
            { $lookup: { from: "exams", localField: "examId", foreignField: "_id", as: "examData" } }, { $unwind: "$examData" }, 
            { $match: matchStage },
            { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'studentData' } }, { $unwind: '$studentData' },
        ];
        const [totalResult] = await SubexamModel.aggregate([...basePipeline, { $count: "total" }]);
        const totalSubmissions = totalResult ? totalResult.total : 0;
        const dataPipeline = [
            ...basePipeline, { $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit },
            {
                $project: { annotationData: 1, _id: 1, createdAt: 1, updatedAt: 1, score: 1, notes: 1, fileBucket: 1, fileKey: 1, filePath: 1, teacherFeedback: 1,
                    examId: { _id: '$examData._id', Name: '$examData.Name', startdate: '$examData.startdate', enddate: '$examData.enddate' },
                    studentId: { _id: '$studentData._id', userName: '$studentData.userName', firstName: '$studentData.firstName', lastName: '$studentData.lastName' }
                }
            }
        ];
        const submissions = await SubexamModel.aggregate(dataPipeline);
        return res.status(200).json({
            message: "Submitted exams fetched successfully.",
            total: totalSubmissions,
            totalPages: Math.ceil(totalSubmissions / limit),
            currentPage: pageNum,
            data: submissions
        });
    }

    //================================ Student Logic (Unchanged) ================================//
    const studentPipeline = [
        { $match: { studentId: user._id } },
        { $lookup: { from: "exams", localField: "examId", foreignField: "_id", as: "examData" } }, { $unwind: "$examData" },
        { $addFields: { exceptionEntry: { $arrayElemAt: [{ $filter: { input: "$examData.exceptionStudents", as: "ex", cond: { $eq: ["$$ex.studentId", user._id] } } }, 0] } } },
        { $addFields: { effectiveStartDate: { $ifNull: ["$exceptionEntry.startdate", "$examData.startdate"] }, effectiveEndDate: { $ifNull: ["$exceptionEntry.enddate", "$examData.enddate"] } } },
    ];
    if (status) {
        const statusMatch = {};
        if (status === 'active') { statusMatch.effectiveStartDate = { $lte: currentDate }; statusMatch.effectiveEndDate = { $gte: currentDate }; } 
        else if (status === 'upcoming') { statusMatch.effectiveStartDate = { $gt: currentDate }; } 
        else if (status === 'expired') { statusMatch.effectiveEndDate = { $lt: currentDate }; }
        studentPipeline.push({ $match: statusMatch });
    }
    const [totalResult] = await SubexamModel.aggregate([...studentPipeline, { $count: "total" }]);
    const totalSubmissions = totalResult ? totalResult.total : 0;
    const dataPipeline = [
        ...studentPipeline, { $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit },
        { $project: { annotationData: 1, _id: 1, createdAt: 1, updatedAt: 1, score: 1, notes: 1, fileBucket: 1, fileKey: 1, filePath: 1, teacherFeedback: 1, examId: { _id: '$examData._id', Name: '$examData.Name', startdate: '$examData.startdate', enddate: '$examData.enddate' } }}
    ];
    const submissions = await SubexamModel.aggregate(dataPipeline);
    res.status(200).json({
        message: "Your submitted exams fetched successfully",
        total: totalSubmissions,
        totalPages: Math.ceil(totalSubmissions / limit),
        currentPage: pageNum,
        data: submissions.map(s => ({ ...s, studentId: user }))
    });
});

export const getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
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
        teacherFeedback : "studentInfo.teacherFeedback" ,
                notes : "studentInfo.notes" ,

        // Will be null if no submission
        score: "$submission.score", // Include score
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