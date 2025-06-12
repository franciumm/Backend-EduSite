
import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import { pagination } from "../../../utils/pagination.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";

export const getExams = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 10, groupId, gradeId, status } = req.query;

  // Extract user details and role
  const user = req.user;
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();

  // 1. Pagination helpers
  const { limit, skip } = pagination({ page, size });

  let exams = [];
  let totalExams = 0;

  // 2. Teacher logic
  if (isTeacher) {
    // Build a query object
    const query = {};

    // Optional filters
    if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
      query.groupIds = groupId; // exam must include this group
    }
    if (gradeId && mongoose.Types.ObjectId.isValid(gradeId)) {
      query.grade = gradeId; // exam must match this grade
    }

    // Timeline status (using main exam timeline)
    if (status === "active") {
      query.startdate = { $lte: currentDate };
      query.enddate = { $gte: currentDate };
    } else if (status === "upcoming") {
      query.startdate = { $gt: currentDate };
    } else if (status === "expired") {
      query.enddate = { $lt: currentDate };
    }

    // Fetch (with pagination)
    exams = await examModel
      .find(query)
      .sort({ startdate: 1 }) // soonest exam first
      .skip(skip)
      .limit(limit)
      .select("Name startdate enddate groupIds grade exceptionStudents");

    totalExams = await examModel.countDocuments(query);
  } else {
    
   
      let student = await studentModel.findById(user._id).lean();
          if (!student) {
        return res.status(404).json({ message: "Student not found" });
      };
     var studentQuery = {
      $or: [
        { groupIds : student.groupId },
        { enrolledStudents: user._id },
        { "exceptionStudents.studentId": user._id },
      ],
    };
    


    
    let allExams = await examModel
      .find(studentQuery)
      .sort({ startdate: 1 })
      .select("Name startdate enddate groupIds grade exceptionStudents");

   
    const filtered = allExams.filter((exam) => {
      
      if (!status) return true; 
      const exceptionEntry = exam.exceptionStudents.find(
        (ex) => ex.studentId.toString() === user._id.toString()
      );

      const examStart = exceptionEntry ? exceptionEntry.startdate : exam.startdate;
      const examEnd = exceptionEntry ? exceptionEntry.enddate : exam.enddate;

      if (status === "active") {
        return examStart <= currentDate && examEnd >= currentDate;
      } else if (status === "upcoming") {
        return examStart > currentDate;
      } else if (status === "expired") {
        return examEnd < currentDate;
      }
      // If we get here, no match
      return false;
    });

    totalExams = filtered.length;

    // Step C: Apply pagination in memory
    exams = filtered.slice(skip, skip + limit);
  }

  // 4. Return the response
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
  const { page = 1, size = 10, groupId, gradeId, status } = req.query;

  const user = req.user;
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();
  const { limit, skip } = pagination({ page, size });

  let basePipeline = [];
  let countPipeline = [];

  // 1. Teacher Logic (Refactored with Aggregation)
  if (isTeacher) {
    const matchStage = {};

    // Build the $match stage based on fields from the joined "exam" document.
    // We prefix fields with "examData." which is the name we'll give the joined data.
    if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
      // Assuming 'exam' schema has 'groupIds' as an array, like the assignment schema.
      matchStage["examData.groupIds"] = new mongoose.Types.ObjectId(groupId);
    }
    if (gradeId && mongoose.Types.ObjectId.isValid(gradeId)) {
      matchStage["examData.grade"] = new mongoose.Types.ObjectId(gradeId);
    }

    if (status === "active") {
      matchStage["examData.startdate"] = { $lte: currentDate };
      matchStage["examData.enddate"] = { $gte: currentDate };
    } else if (status === "upcoming") {
      matchStage["examData.startdate"] = { $gt: currentDate };
    } else if (status === "expired") {
      matchStage["examData.enddate"] = { $lt: currentDate };
    }

    basePipeline = [
      // Step A: Join with the 'exams' collection
      {
        $lookup: {
          from: "exams", // The actual name of the exams collection in the DB
          localField: "examId",
          foreignField: "_id",
          as: "examData",
        },
      },
      // Step B: Deconstruct the examData array to filter on its fields
      { $unwind: "$examData" },
      // Step C: Apply all filters
      { $match: matchStage },
      // Step D: Join with students to get their details
      {
        $lookup: {
            from: 'students',
            localField: 'studentId',
            foreignField: '_id',
            as: 'studentData'
        }
      },
      { $unwind: '$studentData' },
    ];

  } else {
    // 2. Student Logic (Refactored with Aggregation)
    
    // This pipeline dynamically calculates the effective exam dates for the student
    // by considering the exceptionStudents array on the exam.
    basePipeline = [
      // Step A: Immediately filter for the current student. This is very fast.
      { $match: { studentId: user._id } },
      // Step B: Join with the 'exams' collection
      {
        $lookup: {
          from: "exams",
          localField: "examId",
          foreignField: "_id",
          as: "examData",
        },
      },
      { $unwind: "$examData" },
      // Step C: Create dynamic fields for the effective start and end dates
      {
        $addFields: {
          exceptionEntry: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$examData.exceptionStudents",
                  as: "ex",
                  cond: { $eq: ["$$ex.studentId", user._id] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          effectiveStartDate: { $ifNull: ["$exceptionEntry.startdate", "$examData.startdate"] },
          effectiveEndDate: { $ifNull: ["$exceptionEntry.enddate", "$examData.enddate"] },
        },
      },
    ];

    // Step D: Apply status filter based on the new dynamic dates
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
        basePipeline.push({ $match: statusMatch });
    }
    
    // Students can see their own details, no need for another lookup
    basePipeline.push({
        $addFields: { studentData: req.user }
    });
  }

  // 3. Execute Pipelines for Count and Data
  countPipeline = [...basePipeline, { $count: "total" }];

  const dataPipeline = [
    ...basePipeline,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    // Reshape the output to match the original populated structure
    {
      $project: {
        _id: 1,
        createdAt: 1,
        updatedAt: 1,
        score: 1,
        notes: 1,
        fileBucket: 1,
        fileKey: 1,
        filePath: 1,
        teacherFeedback: 1,
        examId: { // Recreate the populated look
            _id: '$examData._id',
            Name: '$examData.Name',
            startdate: '$examData.startdate',
            enddate: '$examData.enddate',
            groupIds: '$examData.groupIds',
            grade: '$examData.grade',
        },
        studentId: {
            _id: '$studentData._id',
            userName: '$studentData.userName',
            firstName: '$studentData.firstName',
            lastName: '$studentData.lastName',
        }
      }
    }
  ];

  const [totalResult] = await SubexamModel.aggregate(countPipeline);
  const totalSubmissions = totalResult ? totalResult.total : 0;
  const submissions = await SubexamModel.aggregate(dataPipeline);

  // 4. Return the response
  res.status(200).json({
    message: "Submitted exams fetched successfully",
    submissions,
    totalSubmissions,
    totalPages: Math.ceil(totalSubmissions / limit),
    currentPage: parseInt(page, 10),
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