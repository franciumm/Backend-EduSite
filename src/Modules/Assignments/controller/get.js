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

export const GetAllByGroup = asyncHandler(async (req, res, next) => {
    const { gradeId, groupId } = req.query;
    const query = {};

    
   if (req.isteacher) { // Teacher Logic
        const { user } = req;
        if (user.role === 'main_teacher') {
            // Main teacher has unrestricted access, build query from params.
            if (!gradeId && !groupId) return next(new Error("Query failed: A gradeId or groupId is required.", { cause: 400 }));
            if (gradeId) query.gradeId = gradeId;
            if (groupId) query.groupIds = groupId;
        } else if (user.role === 'assistant') {
            // Assistant MUST query by a group they have permission for.
            if (!groupId) return next(new Error("Assistants must query by a specific groupId.", { cause: 400 }));

            const permittedGroupIds = new Set(user.permissions.assignments.map(id => id.toString()));
            if (!permittedGroupIds.has(groupId)) {
                return next(new Error("Forbidden: You do not have permission to view assignments for this group.", { cause: 403 }));
            }
            // If permitted, proceed with the query.
            query.groupIds = groupId;
            if (gradeId) query.gradeId = gradeId;
        }
    }  else {
         const studentGradeId = req.user.gradeId?.toString();
        const studentGroupId = req.user.groupId?.toString();

        if (!studentGradeId) {
            return next(new Error("Unauthorized: You are not associated with any grade.", { cause: 403 }));
        }
        // Enforce student's own grade
        query.gradeId = studentGradeId;

        // If a groupId is passed in query, it MUST match the student's own group.
        if (groupId && groupId !== studentGroupId) {
            return next(new Error("Unauthorized: You can only view assignments for your own group.", { cause: 403 }));
        }
        
        // If no groupId is passed, or if it matches, filter by the student's group.
        if (studentGroupId) {
            query.groupIds = studentGroupId;
        }
    }

    // Execute the constructed query
    const assignments = await assignmentModel.find(query);
    res.status(200).json({ message: "Assignments fetched successfully", data: assignments });
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
    
    // --- Path A: Group Status View (Performant Aggregation) ---
    if (groupId && assignmentId && !studentId) {
        const assignmentObjectId = new mongoose.Types.ObjectId(assignmentId);
        const groupObjectId = new mongoose.Types.ObjectId(groupId);

        const [assignment, group] = await Promise.all([
            assignmentModel.findById(assignmentObjectId).lean(),
            groupModel.findById(groupObjectId).lean()
        ]);
        if (!assignment) return next(new Error("Assignment not found.", { cause: 404 }));
        if (!group) return next(new Error("Group not found.", { cause: 404 }));
        
        const studentQuery = { groupId: groupObjectId };
        const total = await studentModel.countDocuments(studentQuery);

        const pipeline = [
            { $match: studentQuery }, { $sort: { firstName: 1 } }, { $skip: skip }, { $limit: limit },
            {
                $lookup: {
                    from: 'subassignments',
                    let: { student_id: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $and: [ { $eq: ["$studentId", "$$student_id"] }, { $eq: ["$assignmentId", assignmentObjectId] } ] } } },
                        { $sort: { version: -1 } }, { $limit: 1 },
                        { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'studentId' } },
                        { $unwind: '$studentId' },
                        { $lookup: { from: 'assignments', localField: 'assignmentId', foreignField: '_id', as: 'assignmentId' } },
                        { $unwind: '$assignmentId' },
                    ],
                    as: 'submissionDetails'
                }
            },
            {
                $project: {
                    _id: 1, userName: 1, firstName: 1, lastName: 1,
                    status: { $cond: { if: { $gt: [{ $size: "$submissionDetails" }, 0] }, then: 'submitted', else: 'not submitted' } },
                    submissionDetails: { $ifNull: [{ $first: "$submissionDetails" }, null] }
                }
            }
        ];
        let data = await studentModel.aggregate(pipeline);
        
        if (status) data = data.filter(s => s.status === status);

        // This `return` ensures this is the final action for this code path.
        return res.status(200).json({
            message: "Submission status for group fetched successfully.",
            assignmentName: assignment.name, total, totalPages: Math.ceil(total / limit), currentPage: pageNum, data
        });
    }

    // --- Path B: All Other Queries (Now correctly structured) ---
    // This code only runs if the 'if' block above is false.
    
    // We now build upon the `filter` object that was created during authorization.
    if (groupId) filter.groupId = new mongoose.Types.ObjectId(groupId);
    if (assignmentId) filter.assignmentId = new mongoose.Types.ObjectId(assignmentId);
    if (studentId) filter.studentId = new mongoose.Types.ObjectId(studentId);
    if (status && ['marked', 'unmarked'].includes(status)) filter.isMarked = (status === 'marked');
    if (Object.keys(filter).length === 0) return next(new Error("At least one query parameter is required.", { cause: 400 }));

    const [submissions, total] = await Promise.all([
        SubassignmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
            .populate('studentId', 'userName firstName lastName')
            .populate('assignmentId', 'name')
            .populate('groupId', 'groupname').lean(),
        SubassignmentModel.countDocuments(filter)
    ]);
    
    return res.status(200).json({
        message: "Submissions fetched successfully.", total, totalPages: Math.ceil(total / limit), currentPage: pageNum, data: submissions
    });
});


export const getSubmissions = asyncHandler(async (req, res, next) => {
    const { assignmentId, submissionId } = req.query;
    const { user, isteacher } = req;

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("Assignment ID is required and must be a valid ID.", { cause: 400 }));
    }

    // --- REFACTOR: Use the new centralized submission authorizer ---
    const hasAccess = await canViewSubmissionsFor({
        user,
        isTeacher: isteacher,
        contentId: assignmentId,
        contentType: 'assignment'
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to view submissions for this assignment.", { cause: 403 }));
    }
    // --- END REFACTOR ---

    // Now that we know the user is authorized, we can proceed to fetch the data.
    let submissions;
    if (submissionId) {
        // Fetch a single submission
        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
            return next(new Error("Invalid Submission ID format.", { cause: 400 }));
        }
        submissions = await SubassignmentModel.findOne({
            _id: submissionId,
            assignmentId, // Ensure it belongs to the correct parent assignment
        }).populate("studentId", "userName firstName lastName email");

        // Extra check: if student, they can only view their own submission, even if they have access to the assignment.
        if (!isteacher.teacher && submissions && !submissions.studentId._id.equals(user._id)) {
            return next(new Error("You are not authorized to view this specific submission.", { cause: 403 }));
        }

    } else {
        // Fetch a list of submissions
        const { limit, skip } = pagination(req.query);
        const query = { assignmentId };
        
        // If the user is a student, scope the list to only their own submissions.
        if (!isteacher.teacher) {
            query.studentId = user._id;
        }

        submissions = await SubassignmentModel.find(query)
            .populate("studentId", "userName firstName lastName email")
            .skip(skip)
            .limit(limit)
            .sort({ isMarked: 1, createdAt: -1 });
    }
    
    if (!submissions) {
        return res.status(404).json({ message: "No submissions found." });
    }

    res.status(200).json({ message: "Submissions retrieved successfully", submissions });
});

export const getAssignmentsForUser = asyncHandler(async (req, res, next) => {
    const { page = 1, size = 10, status } = req.query;
    const { user, isteacher } = req;
    const { limit, skip } = pagination({ page, size });
    const uaeTimeZone = 'Asia/Dubai';
    const currentDate = toZonedTime(new Date(), uaeTimeZone);

    let query = {};

    // --- Teacher Logic (Unchanged) ---
    if (isteacher) {
        if (user.role === 'main_teacher') {
            query = {};
        } else if (user.role === 'assistant') {
            const groupIds = user.permissions.assignments || [];
            if (groupIds.length === 0) {
                return res.status(200).json({ message: "No assignments found.", assignments: [], totalAssignments: 0, totalPages: 0, currentPage: 1 });
            }
            query = { groupIds: { $in: groupIds } };
        }
         if (status) {
            if (status === "active") { query.startDate = { $lte: currentDate }; query.endDate = { $gte: currentDate }; }
            else if (status === "upcoming") { query.startDate = { $gt: currentDate }; }
            else if (status === "expired") { query.endDate = { $lt: currentDate }; }
        }

    // --- Student Logic (Rewritten to be Correct and Un-buggy) ---
    } else {
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student) {
            return res.status(200).json({ message: "No assignments found for this user.", assignments: [], totalAssignments: 0, totalPages: 0, currentPage: 1 });
        }
        
        // Base query for student enrollment
        const orConditions = [{ enrolledStudents: user._id }];
        if (student.groupId) {
            orConditions.push({ groupIds: student.groupId });
            const sections = await sectionModel.find({ groupIds: student.groupId }).select('linkedAssignments').lean();
            if (sections.length > 0) {
                const sectionAssignmentIds = sections.flatMap(sec => sec.linkedAssignments);
                if (sectionAssignmentIds.length > 0) {
                    orConditions.push({ _id: { $in: sectionAssignmentIds } });
                }
            }
        }
        query.$or = orConditions;

        // **THE FIX**: Apply timeline filters correctly based on status.
        // We no longer add a contradictory mandatory filter.
        if (status) {
            if (status === "active") { query.startDate = { $lte: currentDate }; query.endDate = { $gte: currentDate }; }
            else if (status === "expired") { query.endDate = { $lt: currentDate }; }
            else if (status === "upcoming") { query.startDate = { $gt: currentDate }; }
             // If status is not 'upcoming', we default to showing only started assignments.
            if (status !== 'upcoming') {
                query.startDate = { $lte: currentDate };
            }
        } else {
            // Default behavior: show active and expired, but not upcoming.
            query.startDate = { $lte: currentDate };
        }
    }

    const [assignments, totalAssignments] = await Promise.all([
        assignmentModel.find(query).sort({ startDate: -1 }).skip(skip).limit(limit).select("name startDate endDate groupIds createdBy").lean(),
        assignmentModel.countDocuments(query)
    ]);

    res.status(200).json({
        message: "Assignments fetched successfully",
        totalAssignments,
        totalPages: Math.ceil(totalAssignments / limit),
        currentPage: parseInt(page, 10),
        assignments,
    });
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
