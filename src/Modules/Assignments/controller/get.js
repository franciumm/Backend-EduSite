import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand} from "@aws-sdk/client-s3";
import { getPresignedUrlForS3, deleteFileFromS3,uploadFileToS3 } from '../../../utils/S3Client.js';
import mongoose from "mongoose";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { sectionModel } from '../../../../DB/models/section.model.js';
import { canViewSubmissionsFor } from '../../../middelwares/contentAuth.js';
import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";

export const GetAllByGroup = asyncHandler(async (req, res, next) => {
    const { gradeId, groupId } = req.query;
    const query = {};

    // --- Student Logic ---
    if (req.isteacher.teacher === false) {
        const studentGradeId = req.user.gradeId?.toString();
        const studentGroupId = req.user.groupId?.toString();

        // A student must be enrolled in a grade to see any assignments.
        if (!studentGradeId) {
            return next(new Error("Unauthorized: You are not associated with any grade.", { cause: 403 }));
        }

        // Authorization check: If a gradeId is specified in the query, it MUST match the student's own gradeId.
        if (gradeId && gradeId !== studentGradeId) {
            return next(new Error("Unauthorized: You can only view assignments for your own grade.", { cause: 403 }));
        }

        // Securely scope the database query to the student's specific grade.
        query.gradeId = studentGradeId;

        // If the student belongs to a group, also filter by their group.
        // The assignmentModel stores group affiliations in an array called 'groupIds'.
        if (studentGroupId) {
            query.groupIds = studentGroupId;
        }

    // --- Teacher Logic ---
    } else {
        // Teachers must provide at least one filter to prevent fetching all records.
        if (!gradeId && !groupId) {
            return next(new Error("Query failed: A gradeId or groupId is required for teachers.", { cause: 400 }));
        }

        // Build query based on provided filters.
        if (gradeId) {
            query.gradeId = gradeId;
        }
        if (groupId) {
            query.groupIds = groupId;
        }
    }

    // Execute the constructed query
    const assignments = await assignmentModel.find(query);
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
    const { user, isteacher } = req;

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("Assignment ID is required and must be a valid ID.", { cause: 400 }));
    }

    // --- REFACTOR: Use the new centralized submission authorizer ---
    const hasAccess = await canViewSubmissionsFor({
        user,
        isTeacher: isteacher.teacher,
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
    const currentDate = new Date();
    const { limit, skip } = pagination({ page, size });

    let baseMatch = {};

    // --- Main Logic Branch: Check if the user is a teacher or a student ---
    if (isteacher.teacher === true) {
        // --- Teacher Logic ---
        // A teacher sees all assignments they have created.
        baseMatch = { createdBy: user._id };

    } else {
        // --- Student Logic ---
        // 1. Find the student to determine their enrollment details.
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student) {
            // If the user is not a valid student, return an empty result.
            return res.status(200).json({ message: "No assignments found for this user.", assignments: [], totalAssignments: 0, totalPages: 0, currentPage: 1 });
        }
        
        // 2. Dynamically build an array of conditions for the $or query.
        const orConditions = [];

        // Path A: The student is individually enrolled in the assignment.
        orConditions.push({ enrolledStudents: user._id });

        // Paths B and C are only possible if the student belongs to a group.
        if (student.groupId) {
            // Path B: The assignment is open to the student's entire group.
            orConditions.push({ groupIds: student.groupId });

            // Path C: The assignment is linked to a section that the student's group belongs to.
            const sections = await sectionModel.find({ groupIds: student.groupId }).select('linkedAssignments').lean();
            if (sections.length > 0) {
                const sectionAssignmentIds = sections.flatMap(sec => sec.linkedAssignments);
                if (sectionAssignmentIds.length > 0) {
                    orConditions.push({ _id: { $in: sectionAssignmentIds } });
                }
            }
        }
        
        // 3. Construct the student's main query object.
        baseMatch = { $or: orConditions };
    }

    // 4. Dynamically add the optional timeline status filter to the main query (applies to both teachers and students).
    if (status) {
        if (status === "active") {
            baseMatch.startDate = { $lte: currentDate };
            baseMatch.endDate = { $gte: currentDate };
        } else if (status === "upcoming") {
            baseMatch.startDate = { $gt: currentDate };
        } else if (status === "expired") {
            baseMatch.endDate = { $lt: currentDate };
        }
    }

    // 5. Execute the queries for paginated data and total count in parallel.
    const [assignments, totalAssignments] = await Promise.all([
        assignmentModel.find(baseMatch)
            .sort({ startDate: -1 }) // Sort by most recent start date
            .skip(skip)
            .limit(limit)
            .select("name startDate endDate groupIds createdBy") // Select relevant fields
            .lean(),
        assignmentModel.countDocuments(baseMatch)
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
    // --- FIX 1.3: Correct and Robust Authorization ---
    const { SubassignmentId } = req.query; // Changed from assignmentId
    if (!SubassignmentId || !mongoose.Types.ObjectId.isValid(SubassignmentId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    const submission = await SubassignmentModel.findById(SubassignmentId);
    if (!submission) {
        return next(new Error("Submission not found", { cause: 404 }));
    }

    let isAuthorized = false;
    // Rule 1: The student who owns the submission can view it.
    if (req.user._id.equals(submission.studentId)) {
        isAuthorized = true;
    }
    // Rule 2: A teacher can view any submission for an assignment they created.
    else if (req.isteacher.teacher === true) {
        const originalAssignment = await assignmentModel.findById(submission.assignmentId).select('createdBy').lean();
        if (originalAssignment && originalAssignment.createdBy.equals(req.user._id)) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to view this submission.", { cause: 403 }));
    }
    // --- END FIX ---
    
    const presignedUrl = await getPresignedUrlForS3(
        submission.bucketName,
        submission.key,
        60 * 30 // 30-minute expiry
    );
    res.status(200).json({
        message: "Submission is ready for viewing",
        presignedUrl,
    });
});



