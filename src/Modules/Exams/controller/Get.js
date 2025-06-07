
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
    
   
      let student = await studentModel.findById(user._Id);
        studentQuery = {
      $or: [
        { groupIds: student.groupId },
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
export const getSubmittedExams = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 10, groupId, gradeId, status } = req.query;

  // Extract user details and role
  const user = req.user;
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();

  // Pagination helpers
  const { limit, skip } = pagination({ page, size });

  let submissions = [];
  let totalSubmissions = 0;

  // 1. Teacher logic
  if (isTeacher) {
    // Build a query object
    const query = {};

    // Optional filters
    if (groupId && mongoose.Types.ObjectId.isValid(groupId)) {
      query.groupId = groupId;
    }
    if (gradeId && mongoose.Types.ObjectId.isValid(gradeId)) {
      query.gradeId = gradeId;
    }

    // Timeline status (main exam timeline)
    if (status === "active") {
      query.startdate = { $lte: currentDate };
      query.enddate = { $gte: currentDate };
    } else if (status === "upcoming") {
      query.startdate = { $gt: currentDate };
    } else if (status === "expired") {
      query.enddate = { $lt: currentDate };
    }

    // Fetch submissions based on the query
    submissions = await SubexamModel.find(query)
      .populate("examId", "Name startdate enddate groupIds grade")
      .populate("studentId", "userName firstName lastName groupid")
      .sort({ createdAt: -1 }) // Sort by most recent submission
      .skip(skip)
      .limit(limit);

    totalSubmissions = await SubexamModel.countDocuments(query);
  } else {
    // 2. Student logic
    // Step A: Find all submissions for the student
    const studentQuery = {
      studentId: user._id, // Only fetch the submissions by this student
    };

    // Fetch submissions
    let allSubmissions = await SubexamModel.find(studentQuery)
      .populate("examId", "Name startdate enddate groupIds grade exceptionStudents")
      .sort({ createdAt: -1 }); // Most recent submissions first

    // Step B: Filter out based on timeline or exceptions
    const filteredSubmissions = allSubmissions.filter((submission) => {
      const exam = submission.examId;

      // Find custom timeline if the student is an exception
      const exceptionEntry = exam.exceptionStudents?.find(
        (ex) => ex.studentId.toString() === user._id.toString()
      );

      const examStart = exceptionEntry ? exceptionEntry.startdate : exam.startdate;
      const examEnd = exceptionEntry ? exceptionEntry.enddate : exam.enddate;

      if (!status) return true; // If no status, show all

      if (status === "active") {
        return examStart <= currentDate && examEnd >= currentDate;
      } else if (status === "upcoming") {
        return examStart > currentDate;
      } else if (status === "expired") {
        return examEnd < currentDate;
      }

      // If no condition matches, exclude
      return false;
    });

    totalSubmissions = filteredSubmissions.length;

    // Step C: Apply pagination in memory
    submissions = filteredSubmissions.slice(skip, skip + limit);
  }

  // 3. Return the response
  res.status(200).json({
    message: "Submitted exams fetched successfully",
    submissions,
    totalSubmissions,
    totalPages: Math.ceil(totalSubmissions / limit),
    currentPage: parseInt(page, 10),
  });
});
