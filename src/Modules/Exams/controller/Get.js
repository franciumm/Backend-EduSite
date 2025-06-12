
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