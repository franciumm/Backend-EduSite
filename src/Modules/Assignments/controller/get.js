import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand} from "@aws-sdk/client-s3";
import { getPresignedUrlForS3, deleteFileFromS3,uploadFileToS3 } from '../../../utils/S3Client.js';
import mongoose from "mongoose";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";

import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";

export const GetAllByGroup = asyncHandler (async  (req, res, next) => {
  const {groupId}= req.body ;
  req.user.groupId = await groupModel.findById(user._Id);
  if(req.isteacher.teacher== false&& req.user.groupId ==groupId){
    return next(new Error("The Studednt no in This group", { cause: 401 }));
    ;
  }
  const ass = await assignmentModel.find({groupId:groupId});
  res.status(201).json(ass)
})


export const getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
  const { groupId, assignmentId, status, page = 1, size = 10 } = req.query;

  // 1) Validate groupId
  if (!groupId) return next(new Error("Group ID is required", { cause: 400 }));
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    return next(new Error("Valid groupId is required", { cause: 400 }));
  }
  const gId = new mongoose.Types.ObjectId(groupId);

  // 2) If no assignmentId, return every submission record for that group
  if (!assignmentId) {
    // ensure group exists
    const group = await groupModel.findById(gId);
    if (!group) return next(new Error("Group not found", { cause: 404 }));

    // build query
    const query = { groupId: gId };
    // optional status filter on isMarked
    if (status === "marked") query.isMarked = true;
    else if (status === "unmarked") query.isMarked = false;

    // pagination
    const pg = Math.max(1, parseInt(page, 10));
    const sz = Math.max(1, parseInt(size, 10));
    const { limit, skip } = pagination({ page: pg, size: sz });

    // fetch submissions
    const subs = await SubassignmentModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("studentId", "userName firstName lastName")
      .populate("assignmentId", "name")
      .lean();

    const totalSubs = await SubassignmentModel.countDocuments(query);

    return res.status(200).json({
      message: "All submissions for group fetched successfully",
      totalSubmissions: totalSubs,
      totalPages: Math.ceil(totalSubs / limit),
      currentPage: pg,
      submissions: subs
    });
  }

  // 3) Otherwise, validate assignmentId
  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new Error("Valid assignmentId is required", { cause: 400 }));
  }
  const aId = new mongoose.Types.ObjectId(assignmentId);

  // 4) Ensure assignment exists and is linked to this group
  const assignment = await assignmentModel.findById(aId).lean();
  if (!assignment) return next(new Error("Assignment not found", { cause: 404 }));
  const assignedGroups = Array.isArray(assignment.groupIds)
    ? assignment.groupIds
    : assignment.groupId
      ? [assignment.groupId]
      : [];
  if (!assignedGroups.some(id => id.equals(gId))) {
    return next(new Error("Invalid assignment ID for the provided group", { cause: 400 }));
  }

  // 5) Load all students in this group
  const group = await groupModel
    .findById(gId)
    .populate("enrolledStudents", "_id userName firstName lastName")
    .lean();
  if (!group) return next(new Error("Group not found", { cause: 404 }));
  const students = group.enrolledStudents || [];
  if (students.length === 0) {
    return res.status(200).json({ Message: "No Student Attached to it" });
  }

  // 6) Fetch submissions for this assignment + these students
  const subs = await SubassignmentModel.find({
    assignmentId: aId,
    studentId: { $in: students.map(s => s._id) }
  })
    .select("studentId createdAt")
    .lean();

  // 7) Build latest map
  const latestMap = {};
  for (const sub of subs) {
    const sid = sub.studentId.toString();
    const ts  = sub.createdAt;
    if (!latestMap[sid] || ts > latestMap[sid]) {
      latestMap[sid] = ts;
    }
  }

  // 8) Merge students + status + submittedAt
  let fullList = students.map(s => {
    const sid = s._id.toString();
    const ts  = latestMap[sid];
    return {
      _id:        s._id,
      userName:   s.userName,
      firstName:  s.firstName,
      lastName:   s.lastName,
      status:     ts ? "submitted" : "not submitted",
      submittedAt: ts ? new Date(ts).toLocaleString() : null
    };
  });

  // 9) Status filter
  if (status === "submitted") {
    fullList = fullList.filter(x => x.status === "submitted");
  } else if (status === "not_submitted") {
    fullList = fullList.filter(x => x.status === "not submitted");
  }

  // 🔟 Paginate
  const pg = Math.max(1, parseInt(page, 10));
  const { limit, skip } = pagination({ page: pg, size: Math.max(1, parseInt(size, 10)) });
  const totalStudents = fullList.length;
  const paged = fullList.slice(skip, skip + limit);

  res.status(200).json({
    message:      "Submissions fetched successfully",
    totalStudents,
    totalPages:   Math.ceil(totalStudents / limit),
    currentPage:  pg,
    students:     paged
  });
});

export const getSubmissions = asyncHandler(async (req, res, next) => {
  const { assignmentId, submissionId } = req.query;
  const userId = req.user._id;
  const isTeacher = req.isteacher?.teacher === true;

  // 1) assignmentId required
  if (!assignmentId) {
    return next(new Error("Assignment ID is required", { cause: 400 }));
  }

  // 2) load assignment
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 3) if student, verify they’re in the assignment’s group
  if (!isTeacher) {
    const student = await studentModel.findById(userId);
    if (!student) {
      return next(new Error("Student record not found", { cause: 404 }));
    }
    if (!assignment.groupId.equals(student.groupId)) {
      return next(new Error("You’re not authorized to view these submissions", { cause: 403 }));
    }
  }

  let submissions;
  if (submissionId) {
    // 4a) single submission
    submissions = await SubassignmentModel.findOne({
      _id: submissionId,
      assignmentId,
    }).populate("studentId", "userName firstName lastName email");
    if (!submissions) {
      return next(new Error("Submission not found", { cause: 404 }));
    }
    if (
      !isTeacher &&
      submissions.studentId._id.toString() !== userId.toString()
    ) {
      return next(new Error("You’re not authorized to view this submission", { cause: 403 }));
    }
  } else {
    // 4b) all submissions (with pagination)
    const { limit, skip } = pagination(req.query);
    const query = { assignmentId };
    if (!isTeacher) query.studentId = userId;

    submissions = await SubassignmentModel.find(query)
      .populate("studentId", "userName firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ isMarked: 1, createdAt: -1 });
  }

  res.status(200).json({
    message: "Submissions retrieved successfully",
    submissions,
  });
});

export const getAssignmentsForStudent = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 10, status } = req.query;

  const user = req.user; // The authenticated user
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();

  try {
    const query = {};

    if (isTeacher) {
      // If the user is a teacher, fetch assignments they created or all assignments
      if (req.query.groupId && mongoose.Types.ObjectId.isValid(req.query.groupId)) {
        query.groupId = req.query.groupId; // Filter by group if specified
      }
    } else {
      // For students, filter by their group
      
        let student = await studentModel.findById(user._id).lean();
          if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      query.groupId = student.groupId;
    }


    if (status) {
      if (status === "active") {
        query.startDate = { $lte: currentDate };
        query.endDate = { $gte: currentDate };
      } else if (status === "upcoming") {
        query.startDate = { $gt: currentDate };
      } else if (status === "expired") {
        query.endDate = { $lt: currentDate };
      }
    }

    // Pagination helpers
    const { limit, skip } = pagination({ page, size });

    // Fetch assignments
    const assignments = await assignmentModel
      .find(query)
      .sort({ startDate: 1 }) // Sort by start date
      .skip(skip)
      .limit(limit)
      .select("name startDate endDate groupId rejectedStudents enrolledStudents") // Select specific fields
      .populate("groupId", "name"); // Populate group details

    // Total count for pagination
    const totalAssignments = await assignmentModel.countDocuments(query);

    // Response
    res.status(200).json({
      message: "Assignments fetched successfully",
      totalAssignments,
      totalPages: Math.ceil(totalAssignments / limit),
      currentPage: parseInt(page, 10),
      assignments,
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    next(new Error("Failed to fetch assignments", { cause: 500 }));
  }
});


export const ViewSub = asyncHandler(async(req, res, next) =>{


  const userId    = req.user._id;
  const isTeacher = req.isteacher.teacher;
  const { SubassignmentId } = req.query;

  // fetch it
  const assignment = await SubassignmentModel.findById(SubassignmentId);
  if (!assignment) {
    return next(new Error("Subassignment not found", { cause: 404 }));
  }

  if (!isTeacher) {
    
    if ( assignment.studentId != userId ) {
      return next(new Error("You are not valid to it boy ", { cause: 403 }));
    }
  }

  // anyone authorized gets a presigned GET URL
  const presignedUrl = await getPresignedUrlForS3(
    assignment.bucketName,
    assignment.key,
    60 * 30
  );
  res.status(200).json({
    message:     "SubAssg  is ready for viewing",
    presignedUrl,
  });
});



