
import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";

import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import { pagination } from "../../../utils/pagination.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { canAccessContent } from "../../../middelwares/contentAuth.js";


export const getExams = asyncHandler(async (req, res, next) => {
    // ... (logic for teachers and initial setup remains the same)
    const { page = 1, size = 10, groupId, gradeId, status } = req.query;
    const uaeTimeZone = 'Asia/Dubai';
    const user = req.user;
    const isTeacher = req.isteacher.teacher;
    const currentDate = toZonedTime(new Date(), uaeTimeZone);
    const { limit, skip } = pagination({ page, size });

    let query = {};
    let totalExams = 0;
    let exams = [];

    if (isTeacher) {
        if (groupId) query.groupIds = groupId;
        if (gradeId) query.grade = gradeId;
        if (status === "active") { query.startdate = { $lte: currentDate }; query.enddate = { $gte: currentDate }; }
        if (status === "upcoming") { query.startdate = { $gt: currentDate }; }
        if (status === "expired") { query.enddate = { $lt: currentDate }; }

        [exams, totalExams] = await Promise.all([
            examModel.find(query).sort({ startdate: 1 }).skip(skip).limit(limit).select("Name startdate enddate groupIds grade").lean(),
            examModel.countDocuments(query)
        ]);
    } else {
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student) {
            return res.status(200).json({ message: "No exams found.", exams: [], totalExams: 0, totalPages: 0, currentPage: 1 });
        }

        // =================================================================
        // --- FINAL PERFECTION: Build the $or array dynamically and safely ---
        // =================================================================
        const orConditions = [
            // Path 2: Student is a specific exception
            { "exceptionStudents.studentId": user._id },
            // Path 3: Student was manually enrolled
            { enrolledStudents: user._id }
        ];

        // Path 1: Student's group is assigned (ONLY if they have a group)
        if (student.groupId) {
            orConditions.push({ groupIds: student.groupId });
        }
        
        const baseMatch = { $or: orConditions };

        const pipeline = [
            { $match: baseMatch },
            { $addFields: { studentException: { $first: { $filter: { input: "$exceptionStudents", as: "ex", cond: { $eq: ["$$ex.studentId", user._id] } } } } } },
            { $addFields: { effectiveStartDate: { $ifNull: ["$studentException.startdate", "$startdate"] }, effectiveEndDate: { $ifNull: ["$studentException.enddate", "$enddate"] } } }
        ];

        if (status) {
            const statusMatch = {};
            if (status === "active") { statusMatch.effectiveStartDate = { $lte: currentDate }; statusMatch.effectiveEndDate = { $gte: currentDate }; }
            if (status === "upcoming") { statusMatch.effectiveStartDate = { $gt: currentDate }; }
            if (status === "expired") { statusMatch.effectiveEndDate = { $lt: currentDate }; }
            pipeline.push({ $match: statusMatch });
        }
        
        const results = await examModel.aggregate([
            ...pipeline,
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: { effectiveStartDate: 1 } },
                        { $skip: skip },
                        { $limit: limit },
                        { $project: { Name: 1, startdate: 1, enddate: 1, groupIds: 1, grade: 1, exceptionStudents: 1 } }
                    ]
                }
            }
        ]);
        
        exams = results[0].data;
        totalExams = results[0].metadata[0]?.total || 0;
    }

    res.status(200).json({
        message: "Exams fetched successfully",
        exams,
        totalExams,
        totalPages: Math.ceil(totalExams / limit),
        currentPage: parseInt(page, 10),
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
    const isTeacher = isteacher?.teacher === true;
    const uaeTimeZone = 'Asia/Dubai';
    const currentDate = toZonedTime(new Date(), uaeTimeZone);

    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (pageNum - 1) * limit;

    //================================ Teacher Logic ================================//
    if (isTeacher) {
        // --- Path A: "Group Status View" - Get status for every student in a group for a specific exam ---
        // This is triggered ONLY when a groupId and examId are provided together.
        if (groupId && examId && !studentId) {
            if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("Invalid Group ID format.", { cause: 400 }));
            if (!mongoose.Types.ObjectId.isValid(examId)) return next(new Error("Invalid Exam ID format.", { cause: 400 }));

            const [exam, group] = await Promise.all([
                examModel.findOne({ _id: examId, groupIds: groupId }).lean(),
                groupModel.findById(groupId).lean()
            ]);

            if (!exam) return next(new Error("Exam not found or is not assigned to this group.", { cause: 404 }));
            if (!group) return next(new Error("Group not found.", { cause: 404 }));

            const [students, total] = await Promise.all([
                studentModel.find({ groupId }).select('_id userName firstName lastName').sort({ firstName: 1 }).skip(skip).limit(limit).lean(),
                studentModel.countDocuments({ groupId })
            ]);

            let hydratedData = [];
            if (students.length > 0) {
                const studentIdsOnPage = students.map(s => s._id);

                // Fetch ALL submissions for the students on the current page for this specific exam
                // **MODIFICATION**: Sort by version to get the newest first.
                const submissions = await SubexamModel.find({
                    examId: exam._id,
                    studentId: { $in: studentIdsOnPage }
                }).sort({ version: -1 }).lean(); // Or { createdAt: -1 }

                // **MODIFICATION**: Create a Map that holds an ARRAY of submissions for each student
                const submissionMap = new Map(studentIdsOnPage.map(id => [id.toString(), []]));
                submissions.forEach(sub => {
                    submissionMap.get(sub.studentId.toString()).push(sub);
                });

                // **MODIFICATION**: Hydrate the student list with their submission history
                hydratedData = students.map(student => {
                    const studentSubmissions = submissionMap.get(student._id.toString());

                    if (studentSubmissions && studentSubmissions.length > 0) {
                        // If they submitted, return a rich object with their submission history
                        return {
                            _id: student._id,
                            userName: student.userName,
                            firstName: student.firstName,
                            lastName: student.lastName,
                            status: 'submitted',
                            submissionCount: studentSubmissions.length,
                            // Embed the entire array of submission objects, newest first
                            submissions: studentSubmissions 
                        };
                    } else {
                        // If they haven't submitted, return a lean status object
                        return {
                            _id: student._id,
                            userName: student.userName,
                            firstName: student.firstName,
                            lastName: student.lastName,
                            status: 'not submitted',
                            submissionCount: 0,
                            submissions: []
                        };
                    }
                });
            }

            // After hydrating, apply the final status filter if provided
            if (status && ['submitted', 'not submitted'].includes(status)) {
                hydratedData = hydratedData.filter(s => s.status === status);
            }

            return res.status(200).json({
                message: "Submission status for group fetched successfully.",
                examName: exam.Name,
                groupName: group.groupname,
                total,
                totalPages: Math.ceil(total / limit),
                currentPage: pageNum,
                data: hydratedData
            });
        }

        // --- Path B: All Other Teacher Queries (Unchanged) ---
        const matchStage = {};
        if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
            matchStage["examData.groupIds"] = new mongoose.Types.ObjectId(groupId);
        }
        if (gradeId && mongoose.Types.ObjectId.isValid(gradeId)) {
            matchStage["examData.grade"] = new mongoose.Types.ObjectId(gradeId);
        }
        if (examId && mongoose.Types.ObjectId.isValid(examId)) {
            matchStage["examData._id"] = new mongoose.Types.ObjectId(examId);
        }
        if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
            matchStage.studentId = new mongoose.Types.ObjectId(studentId);
        }
        if (status === "active") {
            matchStage["examData.startdate"] = { $lte: currentDate };
            matchStage["examData.enddate"] = { $gte: currentDate };
        } else if (status === "upcoming") {
            matchStage["examData.startdate"] = { $gt: currentDate };
        } else if (status === "expired") {
            matchStage["examData.enddate"] = { $lt: currentDate };
        }

        const basePipeline = [
            { $lookup: { from: "exams", localField: "examId", foreignField: "_id", as: "examData" } },
            { $unwind: "$examData" }, { $match: matchStage },
            { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'studentData' } },
            { $unwind: '$studentData' },
        ];
        const [totalResult] = await SubexamModel.aggregate([...basePipeline, { $count: "total" }]);
        const totalSubmissions = totalResult ? totalResult.total : 0;
        const dataPipeline = [
            ...basePipeline,
            { $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit },
            {
                $project: {
                    _id: 1, createdAt: 1, updatedAt: 1, score: 1, notes: 1, fileBucket: 1, fileKey: 1,
                    filePath: 1, teacherFeedback: 1,
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
        { $lookup: { from: "exams", localField: "examId", foreignField: "_id", as: "examData" } },
        { $unwind: "$examData" },
        { $addFields: { exceptionEntry: { $arrayElemAt: [{ $filter: { input: "$examData.exceptionStudents", as: "ex", cond: { $eq: ["$$ex.studentId", user._id] } } }, 0] } } },
        { $addFields: { effectiveStartDate: { $ifNull: ["$exceptionEntry.startdate", "$examData.startdate"] }, effectiveEndDate: { $ifNull: ["$exceptionEntry.enddate", "$examData.enddate"] } } },
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
        studentPipeline.push({ $match: statusMatch });
    }
    const [totalResult] = await SubexamModel.aggregate([...studentPipeline, { $count: "total" }]);
    const totalSubmissions = totalResult ? totalResult.total : 0;
    const dataPipeline = [
        ...studentPipeline,
        { $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit },
        { $project: {
            _id: 1, createdAt: 1, updatedAt: 1, score: 1, notes: 1, fileBucket: 1, fileKey: 1, filePath: 1, teacherFeedback: 1,
            examId: { _id: '$examData._id', Name: '$examData.Name', startdate: '$examData.startdate', enddate: '$examData.enddate' },
        }}
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

  // 1) Validate groupId - Common for both scenarios
  if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
    return next(new Error("A valid Group ID is required", { cause: 400 }));
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
        submittedAt: "$submission.createdAt", // Will be null if no submission
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