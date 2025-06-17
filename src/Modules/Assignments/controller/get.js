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

export const GetAllByGroup = asyncHandler(async (req, res, next) => {
  // Get groupId from request parameters or body. Using params is common for GET requests.
  // Let's assume it's in the body as per your original code.
  const { groupId } = req.query;

  if (!groupId) {
    return next(new Error("Group ID is required.", { cause: 400 }));
  }

  // Authorization check for students
  // Note: We assume that an auth middleware has already populated req.user for students.
  if (req.isTeacher === false) {
    // The logic was inverted. We should check if the student is NOT in the requested group.
    // Also, a student might belong to multiple groups, so req.user.groupIds should be an array.
    // For this example, we'll assume req.user.groupId holds their single group ID.
    req.user.groupId = await groupModel.findById(req.user.groupId);
    if (req.user.groupId.toString() !== groupId) {
      return next(new Error("Unauthorized: You do not have access to this group's assignments.", { cause: 403 }));
    }
  }

  // **THE FIX**: To find if a single value exists within an array in a document,
  // you can query it directly. Mongoose is smart enough to translate this
  // into a query that checks for the element in the array.
  const assignments = await assignmentModel.find({ groupIds: groupId });

  // Use 200 OK for a successful GET request, not 201 Created.
  res.status(200).json({ message: "Assignments fetched successfully", data: assignments });
});

export const getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
    const { groupId, assignmentId, studentId, status, page = 1, size = 10 } = req.query;

    // --- Phase 1: Fail Fast - Input Validation ---
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
        return next(new Error("A valid Group ID is required.", { cause: 400 }));
    }
    if (assignmentId && !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("The provided assignmentId is not a valid ID format.", { cause: 400 }));
    }
    if (studentId && !mongoose.Types.ObjectId.isValid(studentId)) {
        return next(new Error("The provided studentId is not a valid ID format.", { cause: 400 }));
    }
    const gId = new mongoose.Types.ObjectId(groupId);

    // --- Phase 2: Handle "All Submissions for Group" Case ---
    if (!assignmentId) {
        // ... (This logic block remains the same as it was already correct)
        const query = { groupId: gId };
        if (status === "marked") query.isMarked = true;
        else if (status === "unmarked") query.isMarked = false;
        const limit = Math.max(1, parseInt(size, 10));
        const skip = (Math.max(1, parseInt(page, 10)) - 1) * limit;
        const [submissions, totalSubmissions] = await Promise.all([
            SubassignmentModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .populate("studentId", "userName firstName lastName").populate("assignmentId", "name").lean(),
            SubassignmentModel.countDocuments(query)
        ]);
        return res.status(200).json({ message: "All submissions for group fetched successfully", totalSubmissions, totalPages: Math.ceil(totalSubmissions / limit), currentPage: parseInt(page, 10), submissions });
    }

    // --- Phase 3: NEW - Hyper-Optimized "Single Student Status" Mode ---
    const aId = new mongoose.Types.ObjectId(assignmentId);
    if (studentId) {
        const sId = new mongoose.Types.ObjectId(studentId);
        
        // Run two fast, parallel queries
        const [student, submission] = await Promise.all([
            studentModel.findOne({ _id: sId, groupId: gId }).select("userName firstName lastName").lean(),
            SubassignmentModel.findOne({ assignmentId: aId, studentId: sId }).select("SubmitDate isLate").lean()
        ]);

        if (!student) {
            return next(new Error("The specified student was not found in this group.", { cause: 404 }));
        }

        const responseData = {
            ...student,
            status: submission ? "submitted" : "not submitted",
            submittedAt: submission?.SubmitDate || null,
            isLate: submission?.isLate ?? null,
        };

        return res.status(200).json({
            message: "Submission status for student fetched successfully",
            student: responseData
        });
    }

    // --- Phase 4: Handle "Group Assignment Status" Mode with Aggregation ---
    const assignment = await assignmentModel.findOne({ _id: aId, groupIds: gId }).lean();
    if (!assignment) {
        return next(new Error("The specified assignment was not found or is not linked to this group.", { cause: 404 }));
    }
    
    const studentFilter = { groupId: gId };
    const aggregationPipeline = [ /* ... The full aggregation pipeline from the previous answer ... */ ];
    
    // The rest of your powerful aggregation logic for handling the full group status goes here.
    // This separation ensures it only runs when needed.
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * limit;

    const pipeline = [
        { $match: { groupId: gId } },
        { $lookup: { from: "subassignments", let: { student_id: "$_id" }, pipeline: [ { $match: { $expr: { $and: [ { $eq: ["$studentId", "$$student_id"] }, { $eq: ["$assignmentId", aId] } ] } } } ], as: "submissionDetails" } },
        { $addFields: { submission: { $first: "$submissionDetails" }, status: { $cond: { if: { $gt: [{ $size: "$submissionDetails" }, 0] }, then: "submitted", else: "not submitted" } } } },
        ...(status === "submitted" ? [{ $match: { status: "submitted" } }] : []),
        ...(status === "not_submitted" ? [{ $match: { status: "not submitted" } }] : []),
        { $project: { userName: 1, firstName: 1, lastName: 1, status: 1, submittedAt: "$submission.SubmitDate", isLate: "$submission.isLate", submissionId: "$submission._id" } }
    ];
    
    const [students, totalStudents] = await Promise.all([
        studentModel.aggregate(pipeline).sort({ firstName: 1 }).skip(skip).limit(limit),
        studentModel.countDocuments(studentFilter) // A simpler count is sufficient here
    ]);

    res.status(200).json({
        message: "Submission status fetched successfully",
        assignmentName: assignment.name,
        totalStudents,
        totalPages: Math.ceil(totalStudents / limit),
        currentPage: parseInt(page, 10),
        students
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
        if (req.query.groupId && mongoose.Types.ObjectId.isValid(req.query.groupId)) {
        query.groupIds = mongoose.Types.ObjectId(req.query.groupId);
      }
    } else {
      // For students, filter by their group
      
        let student = await studentModel.findById(user._id).lean();
          if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      query.groupIds  = student.groupId;
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
      .select("name startDate endDate groupIds rejectedStudents enrolledStudents")
      .populate("groupIds", "groupname"); 

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



