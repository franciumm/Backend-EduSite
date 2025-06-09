import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand} from "@aws-sdk/client-s3";
import { getPresignedUrlForS3, deleteFileFromS3,uploadFileToS3 } from '../../../utils/S3Client.js';
import mongoose from "mongoose";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";

export const GetAllByGroup = asyncHandler (async  (req, res, next) => {
  const {groupId}= req.body ;
  req.user.groupId = await studentModel.findById(user._Id);
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
  if (!groupId) {
    return next(new Error("Group ID is required", { cause: 400 }));
  }
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    return next(new Error("Valid groupId is required", { cause: 400 }));
  }
  const gId = new mongoose.Types.ObjectId(groupId);

  // 2) Validate assignmentId
  if (!assignmentId) {
    return next(new Error("Assignment ID is required", { cause: 400 }));
  }
  if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new Error("Valid assignmentId is required", { cause: 400 }));
  }
  const aId = new mongoose.Types.ObjectId(assignmentId);

  // 3) Ensure assignment exists and is linked to this group
  const assignment = await assignmentModel.findById(aId).lean();
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }
  // assignment.groupIds is an array of ObjectIds :contentReference[oaicite:0]{index=0}
  if (!assignment.groupIds.some(id => id.equals(gId))) {
    return next(new Error("Invalid assignment ID for the provided group", { cause: 400 }));
  }

  // 4) Load all students in this group
  const group = await groupModel
    .findById(gId)
    .populate("enrolledStudents", "_id userName firstName lastName") // only needed fields :contentReference[oaicite:1]{index=1}
    .lean();
  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }
  const students = group.enrolledStudents || [];

  // 5) No students attached?
  if (students.length === 0) {
    return res.status(200).json({ Message: "No Student Attached to it" });
  }

  // 6) Fetch all submissions for this assignment+group
  const subs = await SubassignmentModel.find({
    assignmentId: aId,
    studentId: { $in: students.map(s => s._id) }
  })
    .select("studentId createdAt") // get timestamps :contentReference[oaicite:2]{index=2}
    .lean();

  // 7) Build a map of latest submittedAt by studentId
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

  // 9) Apply status filter if requested
  if (status === "submitted") {
    fullList = fullList.filter(x => x.status === "submitted");
  } else if (status === "not_submitted") {
    fullList = fullList.filter(x => x.status === "not submitted");
  }

  // 🔟 Paginate
  const { limit, skip } = pagination({ page: parseInt(page, 10), size: parseInt(size, 10) });
  const totalStudents = fullList.length;
  const paged = fullList.slice(skip, skip + limit);

  // 🏁 Respond
  res.status(200).json({
    message:      "Submissions fetched successfully",
    totalStudents,
    totalPages:   Math.ceil(totalStudents / limit),
    currentPage:  parseInt(page, 10),
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



