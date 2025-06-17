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
    const { groupId, assignmentId, studentId, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const size = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const limit = size;
    const skip = (page - 1) * limit;

    // --- Phase 1: Fail Fast & Pre-flight Validation ---
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
        return next(new Error("A valid Group ID is required.", { cause: 400 }));
    }
    const gId = new mongoose.Types.ObjectId(groupId);

    const validationPromises = [groupModel.findById(gId).select('_id').lean()];
    if (assignmentId) {
        if (!mongoose.Types.ObjectId.isValid(assignmentId)) return next(new Error("Invalid Assignment ID format.", { cause: 400 }));
        validationPromises.push(assignmentModel.findById(assignmentId).select('name').lean());
    }
    const [group, assignment] = await Promise.all(validationPromises);

    if (!group) return next(new Error("Group not found.", { cause: 404 }));
    if (assignmentId && !assignment) return next(new Error("Assignment not found.", { cause: 404 }));

    // --- Phase 2: Build the Base Query and Handle Different Logic Paths ---
    let response;

    if (!assignmentId) {
        // --- Path A: All Submissions in a Group (No Assignment Context) ---
        const filter = { groupId: gId };
        if (status) filter.isMarked = (status === 'marked');
        
        const [submissions, total] = await Promise.all([
            SubassignmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
                .populate('studentId', 'userName firstName lastName')
                .populate('assignmentId', 'name')
                .lean(),
            SubassignmentModel.countDocuments(filter)
        ]);
        response = { total, data: submissions };

    } else {
        // --- Path B, C, D: Assignment Context (Group, Student, or Both) ---
        // This is the core of the "Hydration" pattern to prevent timeouts.
        const studentFilter = { groupId: gId };
        if (studentId) {
            if (!mongoose.Types.ObjectId.isValid(studentId)) return next(new Error("Invalid Student ID format.", { cause: 400 }));
            studentFilter._id = new mongoose.Types.ObjectId(studentId);
        }

        const [students, total] = await Promise.all([
            studentModel.find(studentFilter)
                .select('_id userName firstName lastName')
                .sort({ firstName: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            studentModel.countDocuments(studentFilter)
        ]);

        let hydratedData = [];
        if (students.length > 0) {
            const studentIdsOnPage = students.map(s => s._id);

            // Fetch submissions ONLY for the students on the current page.
            const submissions = await SubassignmentModel.find({
                assignmentId: assignment._id,
                studentId: { $in: studentIdsOnPage }
            }).select('studentId SubmitDate isLate').lean();

            // Create a Map for instant lookups (O(1) complexity).
            const submissionMap = new Map(submissions.map(sub => [sub.studentId.toString(), sub]));

            // Hydrate the student data.
            hydratedData = students.map(student => {
                const submission = submissionMap.get(student._id.toString());
                return {
                    ...student,
                    status: submission ? 'submitted' : 'not submitted',
                    submittedAt: submission?.SubmitDate || null,
                    isLate: submission?.isLate ?? null
                };
            });
        }
        
        // Final status filter on the hydrated data.
        if (status && ["submitted", "not submitted"].includes(status)) {
            hydratedData = hydratedData.filter(s => s.status === status);
        }
        response = { total, data: studentId ? hydratedData[0] || null : hydratedData };
    }

    // --- Phase 3: Respond ---
    res.status(200).json({
        message: "Data fetched successfully",
        assignmentName: assignment?.name || null,
        total: response.total,
        totalPages: Math.ceil(response.total / limit),
        currentPage: page,
        data: response.data
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



