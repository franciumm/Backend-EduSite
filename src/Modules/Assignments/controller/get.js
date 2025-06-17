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
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (pageNum - 1) * limit;

    // --- Phase 1: Dynamically Construct the Core Filter ---
    const filter = {};
    if (groupId) {
        if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("Invalid Group ID format.", { cause: 400 }));
        filter.groupId = new mongoose.Types.ObjectId(groupId);
    }
    if (assignmentId) {
        if (!mongoose.Types.ObjectId.isValid(assignmentId)) return next(new Error("Invalid Assignment ID format.", { cause: 400 }));
        filter.assignmentId = new mongoose.Types.ObjectId(assignmentId);
    }
    if (studentId) {
        if (!mongoose.Types.ObjectId.isValid(studentId)) return next(new Error("Invalid Student ID format.", { cause: 400 }));
        filter.studentId = new mongoose.Types.ObjectId(studentId);
    }
    if (status && ['marked', 'unmarked'].includes(status)) {
        filter.isMarked = (status === 'marked');
    }

    // --- Phase 2: Execute the Correct Logic Path ---

    // Special Case: "Group Status View" requires hydration to find "not submitted" students.
    if (groupId && assignmentId && !studentId) {
        // --- Path A: Group Status View (The "Hydration" Logic) ---
        const [assignment, group] = await Promise.all([
            assignmentModel.findById(filter.assignmentId).lean(),
            groupModel.findById(filter.groupId).lean()
        ]);
        if (!assignment) return next(new Error("Assignment not found.", { cause: 404 }));
        if (!group) return next(new Error("Group not found.", { cause: 404 }));

        const studentsInGroup = await studentModel.find({ groupId: filter.groupId }).select('_id userName firstName lastName').sort({ firstName: 1 }).lean();
        const studentIds = studentsInGroup.map(s => s._id);

        const submissions = await SubassignmentModel.find({ assignmentId: filter.assignmentId, studentId: { $in: studentIds } }).select('studentId SubmitDate isLate').lean();
        const submissionMap = new Map(submissions.map(sub => [sub.studentId.toString(), sub]));

        let hydratedData = studentsInGroup.map(student => ({
            ...student,
            status: submissionMap.has(student._id.toString()) ? 'submitted' : 'not submitted',
            submissionDetails: submissionMap.get(student._id.toString()) || null
        }));

        if (status && ['submitted', 'not submitted'].includes(status)) {
            hydratedData = hydratedData.filter(s => s.status === status);
        }
        
        const total = hydratedData.length;
        const paginatedData = hydratedData.slice(skip, skip + limit);

        return res.status(200).json({
            message: "Submission status for group fetched successfully.",
            assignmentName: assignment.name,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: pageNum,
            data: paginatedData
        });
    }

    // --- Path B: All Other Queries (Direct Find on Submissions) ---
    // This handles: assignmentId only, studentId only, groupId only, and any combination thereof.
    // This is hyper-efficient as it only queries the submission collection.
    if (Object.keys(filter).length === 0) {
        return next(new Error("At least one query parameter (groupId, assignmentId, or studentId) is required.", { cause: 400 }));
    }

    const [submissions, total] = await Promise.all([
        SubassignmentModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('studentId', 'userName firstName lastName')
            .populate('assignmentId', 'name')
            .populate('groupId', 'groupname')
            .lean(),
        SubassignmentModel.countDocuments(filter)
    ]);
    
    res.status(200).json({
        message: "Submissions fetched successfully.",
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: pageNum,
        data: submissions
    });
});
export const findSubmissions = asyncHandler(async (req, res, next) => {
    const { groupId, assignmentId, studentId, status, page = 1, size = 10 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (pageNum - 1) * limit;

    const filter = {};
    // ... (The dynamic filter construction from the previous answer remains the same) ...
    if (groupId) {
        if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("Invalid Group ID format.", { cause: 400 }));
        filter.groupId = new mongoose.Types.ObjectId(groupId);
    }
    if (assignmentId) {
        if (!mongoose.Types.ObjectId.isValid(assignmentId)) return next(new Error("Invalid Assignment ID format.", { cause: 400 }));
        filter.assignmentId = new mongoose.Types.ObjectId(assignmentId);
    }
    if (studentId) {
        if (!mongoose.Types.ObjectId.isValid(studentId)) return next(new Error("Invalid Student ID format.", { cause: 400 }));
        filter.studentId = new mongoose.Types.ObjectId(studentId);
    }
    if (status && ['marked', 'unmarked'].includes(status)) {
        filter.isMarked = (status === 'marked');
    }

    // --- Special Case: "Group Status View" requires rich hydration ---
    if (groupId && assignmentId && !studentId) {
        const [assignment, group] = await Promise.all([
            assignmentModel.findById(filter.assignmentId).lean(),
            groupModel.findById(filter.groupId).lean()
        ]);
        if (!assignment) return next(new Error("Assignment not found.", { cause: 404 }));
        if (!group) return next(new Error("Group not found.", { cause: 404 }));

        const [students, total] = await Promise.all([
            studentModel.find({ groupId: filter.groupId }).select('_id userName firstName lastName').sort({ firstName: 1 }).skip(skip).limit(limit).lean(),
            studentModel.countDocuments({ groupId: filter.groupId })
        ]);
        
        let hydratedData = [];
        if (students.length > 0) {
            const studentIdsOnPage = students.map(s => s._id);

            // --- THE FIX IS HERE ---
            // Fetch the FULL submission documents and populate them.
            const submissions = await SubassignmentModel.find({
                assignmentId: filter.assignmentId,
                studentId: { $in: studentIdsOnPage }
            })
            .populate('studentId', 'userName firstName lastName') // Although we already have this, it can be useful
            .populate('assignmentId', 'name')
            .lean();

            const submissionMap = new Map(submissions.map(sub => [sub.studentId._id.toString(), sub]));

            hydratedData = students.map(student => {
                const submission = submissionMap.get(student._id.toString());
                if (submission) {
                    // If they submitted, return the full, rich submission object.
                    return {
                        _id: student._id,
                        userName: student.userName,
                        firstName: student.firstName,
                        lastName: student.lastName,
                        status: 'submitted',
                        submissionDetails: submission // Embed the entire submission object
                    };
                } else {
                    // If they haven't submitted, return the lean status object.
                    return {
                        _id: student._id,
                        userName: student.userName,
                        firstName: student.firstName,
                        lastName: student.lastName,
                        status: 'not submitted',
                        submissionDetails: null
                    };
                }
            });
        }
        
        if (status && ['submitted', 'not submitted'].includes(status)) {
            hydratedData = hydratedData.filter(s => s.status === status);
        }

        return res.status(200).json({
            message: "Submission status for group fetched successfully.",
            assignmentName: assignment.name,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: pageNum,
            data: hydratedData
        });
    }

    // --- Path B: All Other Queries (Direct Find on Submissions) ---
    if (Object.keys(filter).length === 0) {
        return next(new Error("At least one query parameter (groupId, assignmentId, or studentId) is required.", { cause: 400 }));
    }

    const [submissions, total] = await Promise.all([
        SubassignmentModel.find(filter)
            .sort({ createdAt: -1 }).skip(skip).limit(limit)
            .populate('studentId', 'userName firstName lastName')
            .populate('assignmentId', 'name')
            .populate('groupId', 'groupname')
            .lean(),
        SubassignmentModel.countDocuments(filter)
    ]);
    
    res.status(200).json({
        message: "Submissions fetched successfully.",
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: pageNum,
        data: submissions
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



