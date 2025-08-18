import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import mongoose from "mongoose";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { sectionModel } from '../../../../DB/models/section.model.js';
import { canViewSubmissionsFor } from '../../../middelwares/contentAuth.js';
import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime } from "date-fns-tz";
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";

export const GetAllByGroup = asyncHandler(async (req, res, next) => {
  // 2. GET PAGE AND SIZE FROM QUERY
  const { gradeId, groupId, page, size } = req.query;
  const query = {};

  // Get skip and limit values from the pagination helper
  const { limit, skip } = pagination({ page, size });

  if (req.isteacher) {
    // Teacher Logic
    const { user } = req;
    if (user.role === "main_teacher") {
      if (!gradeId && !groupId)
        return next(
          new Error("Query failed: A gradeId or groupId is required.", {
            cause: 400,
          })
        );
      if (gradeId) query.gradeId = gradeId;
      if (groupId) query.groupIds = groupId;
    } else if (user.role === "assistant") {
      if (!groupId)
        return next(
          new Error("Assistants must query by a specific groupId.", {
            cause: 400,
          })
        );

      const permittedGroupIds = new Set(
        user.permissions.assignments.map((id) => id.toString())
      );
      if (!permittedGroupIds.has(groupId)) {
        return next(
          new Error(
            "Forbidden: You do not have permission to view assignments for this group.",
            { cause: 403 }
          )
        );
      }
      query.groupIds = groupId;
      if (gradeId) query.gradeId = gradeId;
    }
  } else {
    // Student Logic
    const studentGradeId = req.user.gradeId?.toString();
    const studentGroupId = req.user.groupId?.toString();

    if (!studentGradeId) {
      return next(
        new Error("Unauthorized: You are not associated with any grade.", {
          cause: 403,
        })
      );
    }
    query.gradeId = studentGradeId;

    if (groupId && groupId !== studentGroupId) {
      return next(
        new Error("Unauthorized: You can only view assignments for your own group.", {
          cause: 403,
        })
      );
    }

    if (studentGroupId) {
      query.groupIds = studentGroupId;
    }
  }

  // 3. EXECUTE THE CONSTRUCTED QUERY WITH PAGINATION
  const assignments = await assignmentModel
    .find(query)
    .sort({ createdAt: -1 }) // Optional: Good to sort results for consistent pagination
    .skip(skip)
    .limit(limit);

  res
    .status(200)
    .json({ message: "Assignments fetched successfully", data: assignments });
});


export const getSubmissions = asyncHandler(async (req, res, next) => {
  const { assignmentId, submissionId } = req.query;
  const { user, isteacher } = req;

  if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(
      new Error("Assignment ID is required and must be a valid ID.", {
        cause: 400,
      })
    );
  }

  // Use the centralized submission authorizer
  const hasAccess = await canViewSubmissionsFor({
    user,
    isTeacher: isteacher,
    contentId: assignmentId,
    contentType: "assignment",
  });

  if (!hasAccess) {
    return next(
      new Error("You are not authorized to view submissions for this assignment.", {
        cause: 403,
      })
    );
  }

  // --- Logic for fetching a SINGLE submission ---
  if (submissionId) {
    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return next(new Error("Invalid Submission ID format.", { cause: 400 }));
    }

    const submission = await SubassignmentModel.findOne({
      _id: submissionId,
      assignmentId, // Ensure it belongs to the correct parent assignment
    })
      .populate("studentId", "userName firstName lastName email")
      .select("+annotationData"); // <-- FEATURE: Also retrieve hidden annotationData

    if (!submission) {
      return res.status(404).json({ message: "Submission not found." });
    }

    // Extra check: if student, they can only view their own submission.
    if (!isteacher && !submission.studentId._id.equals(user._id)) {
      return next(
        new Error("You are not authorized to view this specific submission.", {
          cause: 403,
        })
      );
    }

    return res
      .status(200)
      .json({ message: "Submission retrieved successfully", submissions: submission });
  }
  // --- Logic for fetching a LIST of submissions ---
  else {
    const { limit, skip } = pagination(req.query);
    const query = { assignmentId };

    // If the user is a student, scope the list to only their own submissions.
    if (!isteacher) {
      query.studentId = user._id;
    }

    const submissionList = await SubassignmentModel.find(query)
      .populate("studentId", "userName firstName lastName email")
      .sort({ isMarked: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      message: "Submissions retrieved successfully",
      submissions: submissionList,
    });
  }
});

export const ViewSub = asyncHandler(async (req, res, next) => {
    const { SubassignmentId } = req.query; 
    if (!SubassignmentId || !mongoose.Types.ObjectId.isValid(SubassignmentId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    const submission = await SubassignmentModel.findById(SubassignmentId).lean();
    if (!submission) {
        return next(new Error("Submission not found", { cause: 404 }));
    }

    let isAuthorized = false;
    if (!req.isteacher && req.user._id.equals(submission.studentId)) {
        isAuthorized = true; // Student owns this submission.
    } else if (req.isteacher) {
        // Use the centralized helper for teachers.
        isAuthorized = await canViewSubmissionsFor({
            user: req.user,
            isTeacher: true,
            contentId: submission.assignmentId,
            contentType: 'assignment'
        });
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to view this submission.", { cause: 403 }));
    }
   
    res.status(200).json({
        message: "Submission is ready for viewing",
        submission,
    });
});




export const findSubmissions = asyncHandler(async (req, res, next) => {
    const { groupId, assignmentId, studentId, status, page = 1, size = 10 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.max(1, parseInt(size, 10));
    const skip = (pageNum - 1) * limit;

    // --- Authorization Check (Correctly builds the initial filter) ---
    const filter = {};
    if (req.isteacher) {
        const { user } = req;
        let hasAccess = false;
        if (assignmentId) {
            hasAccess = await canViewSubmissionsFor({ user, isTeacher: true, contentId: assignmentId, contentType: 'assignment' });
        } else if (groupId) {
            if (user.role === 'main_teacher') hasAccess = true;
            else if (user.role === 'assistant') {
                const permittedGroupIds = new Set(user.permissions.assignments.map(id => id.toString()));
                if (permittedGroupIds.has(groupId)) hasAccess = true;
            }
        } else if (!studentId) {
             return next(new Error("A groupId or assignmentId is required for this query.", { cause: 400 }));
        }
        if (!hasAccess && !studentId) {
            return next(new Error("Forbidden: You are not authorized to view submissions for this content.", { cause: 403 }));
        }
    } else {
        // For students, the filter is always scoped to their own ID.
         filter.studentId = req.user._id;
    }


    // --- Path A: Group Status View (Now correctly scoped) ---

   // --- Path A: Group Status View (This is the primary logic path now) ---
    // We simplify the condition. If a groupId and assignmentId are provided without a studentId,
    // the user's intent is to view the status of the whole class.
    if (groupId && assignmentId && !studentId) {

        // --- Data fetching for context remains the same ---
        const [assignment, group] = await Promise.all([
            assignmentModel.findById(assignmentId).lean(),
            groupModel.findById(groupId).lean()
        ]);
        if (!assignment) return next(new Error("Assignment not found.", { cause: 404 }));
        if (!group) return next(new Error("Group not found.", { cause: 404 }));
        
        // *** THE DEFINITIVE FIX IS HERE ***
        // Build the query for the submissionStatusModel.
        let statusQuery = { contentId: assignmentId, groupId: groupId, contentType: 'assignment' };
        
        // The statusMap is now more comprehensive.
        const statusMap = {
            'submitted': 'submitted',
            'not submitted': 'assigned',
            'marked': 'marked',
            'unmarked': 'submitted' // This is the key that fixes the bug.
        };

        if (status && statusMap[status]) {
            statusQuery.status = statusMap[status];
        }
        
        // We now use this single, correct query for both counting and finding.
        const [total, statuses] = await Promise.all([
            submissionStatusModel.countDocuments(statusQuery),
            submissionStatusModel.find(statusQuery)
                .populate('studentId', '_id userName firstName lastName')
                .populate({ path: 'submissionId', select: '+annotationData' })
                .sort({ 'studentId.firstName': 1 })
                .skip(skip).limit(limit)
                .lean()
        ]);

        const data = statuses.map(s => ({
            _id: s.studentId._id,
            userName: s.studentId.userName,
            firstName: s.studentId.firstName,
            lastName: s.studentId.lastName,
            status: s.status === 'assigned' ? 'not submitted' : s.status, // Keep user-friendly status name
            submissionDetails: s.submissionId
        }));        

        return res.status(200).json({
            message: "Submission status for group fetched successfully.",
            assignmentName: assignment.name, total, totalPages: Math.ceil(total / limit), currentPage: pageNum, data
        });
    }

 // --- Path B: All Other Queries (Fallback for specific student or non-group queries) ---
    const filter = {}; // Build filter from scratch for clarity
    if (studentId) filter.studentId = new mongoose.Types.ObjectId(studentId);
    if (assignmentId) filter.assignmentId = new mongoose.Types.ObjectId(assignmentId);
    if (groupId) filter.groupId = new mongoose.Types.ObjectId(groupId);
    
    // This logic is still needed for when a teacher wants a flat list of all "marked" subs, for example.
    if (status && ['marked', 'unmarked'].includes(status)) {
        filter.isMarked = (status === 'marked');
    }

    if (Object.keys(filter).length === 0) return next(new Error("At least one query parameter is required.", { cause: 400 }));

    const [submissions, total] = await Promise.all([
        SubassignmentModel.find(filter).select('+annotationData').sort({ createdAt: -1 }).skip(skip).limit(limit)
            .populate('studentId', 'userName firstName lastName')
            .populate('assignmentId', 'name')
            .populate('groupId', 'groupname').lean(),
        SubassignmentModel.countDocuments(filter)
    ]);
    
    
    return res.status(200).json({
        message: "Submissions fetched successfully.", total, totalPages: Math.ceil(total / limit), currentPage: pageNum, data: submissions
    });
});

export const getAssignmentsForUser = asyncHandler(async (req, res, next) => {
    const { page = 1, size = 10, status } = req.query;
    const { user, isteacher } = req;
    const { limit, skip } = pagination({ page, size });
    const uaeTimeZone = 'Asia/Dubai';
    const currentDate = toZonedTime(new Date(), uaeTimeZone);
 const streamItems = await contentStreamModel.find({
        userId: user._id,
        contentType: 'assignment'
    }).lean();

    const assignmentIds = streamItems.map(item => item.contentId);

    if (assignmentIds.length === 0) {
        return res.status(200).json({ message: "No assignments found.", assignments: [], totalAssignments: 0, totalPages: 0, currentPage: 1 });
    }

    let matchQuery = { _id: { $in: assignmentIds } };

    // --- Time-based Status Filtering ---
    if (status) {
        if (status === "active") {
            matchQuery.startDate = { $lte: currentDate };
            matchQuery.endDate = { $gte: currentDate };
        } else if (status === "upcoming") {
            matchQuery.startDate = { $gt: currentDate };
        } else if (status === "expired") {
            matchQuery.endDate = { $lt: currentDate };
        }
    }

 
  
const [assignments, totalAssignments] = await Promise.all([
        assignmentModel.find(matchQuery)
            .sort({ startDate: -1 })
            .skip(skip)
            .limit(limit)
            .populate('groupIds', 'groupname')
            .lean(),
        assignmentModel.countDocuments(matchQuery)
    ]);
    
    // 4. Conditionally hide the S3 path for assignments that haven't started yet.
    // This preserves the original logic without a complex aggregation pipeline.
    const processedAssignments = assignments.map(assignment => {
        const showPath = new Date(assignment.startDate) <= currentDate;
        return {
            ...assignment,
            path: showPath ? assignment.path : null,
            // Explicitly remove sensitive fields to be safe
            key: undefined,
            bucketName: undefined,
            answerKey: undefined,
            answerBucketName: undefined,
            answerPath: undefined
        };
    });


    res.status(200).json({
        message: "Assignments fetched successfully",
        totalAssignments,
        totalPages: Math.ceil(totalAssignments / limit),
        currentPage: parseInt(page, 10),
       assignments: processedAssignments,
    });
});