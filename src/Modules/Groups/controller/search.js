import { gradeModel } from '../../../../DB/models/grades.model.js';
import { groupModel } from "../../../../DB/models/groups.model.js";
import { SubassignmentModel } from '../../../../DB/models/submitted_assignment.model.js';
import { SubexamModel } from '../../../../DB/models/submitted_exams.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";

// --- Helper Function for the "Aggregate & Hydrate" Pattern (Unchanged) ---
const hydrateGroupsWithSubmissions = async (groups) => {
    // 1. Aggregate all student IDs from the groups
    if (!groups || groups.length === 0) {
        return [];
    }
    const studentIds = groups.flatMap(group => group.enrolledStudents.map(student => student._id));
    if (studentIds.length === 0) {
        return groups; // No students, no need to fetch submissions
    }

    // 2. Fetch all submissions for these students in parallel
    const [assignmentSubmissions, examSubmissions] = await Promise.all([
        SubassignmentModel.find({ studentId: { $in: studentIds } }).select('studentId assignmentId').lean(),
        SubexamModel.find({ studentId: { $in: studentIds } }).select('studentId examId').lean()
    ]);

    // 3. Create Maps for ultra-fast lookups
    const assgSubmissionsMap = new Map();
    assignmentSubmissions.forEach(sub => {
        const studentIdStr = sub.studentId.toString();
        if (!assgSubmissionsMap.has(studentIdStr)) {
            assgSubmissionsMap.set(studentIdStr, []);
        }
        assgSubmissionsMap.get(studentIdStr).push(sub);
    });

    const examSubmissionsMap = new Map();
    examSubmissions.forEach(sub => {
        const studentIdStr = sub.studentId.toString();
        if (!examSubmissionsMap.has(studentIdStr)) {
            examSubmissionsMap.set(studentIdStr, []);
        }
        examSubmissionsMap.get(studentIdStr).push(sub);
    });

    // 4. Hydrate the original student objects
    groups.forEach(group => {
        group.enrolledStudents.forEach(student => {
            const studentIdStr = student._id.toString();
            student.submittedassignments = assgSubmissionsMap.get(studentIdStr) || [];
            student.submittedexams = examSubmissionsMap.get(studentIdStr) || [];
        });
    });

    return groups;
};

// --- Refactored & Secured Controller Functions ---

export const getall = asyncHandler(async (req, res, next) => {
    const { user, isteacher } = req;
    let query = {};

    // Define the query based on user role
    if (isteacher) {
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.groups?.map(id => id.toString()) || [];
            query = { _id: { $in: permittedGroupIds } };
        }
        // For 'main_teacher', query remains {} to find all.
    } else {
        // For students, find only their specific group.
        if (!user.groupId) {
             return res.status(200).json({ Message: "Done", groups: [] }); // Student not in a group
        }
        query = { _id: user.groupId };
    }

    const groups = await groupModel.find(query).populate({
        path: "enrolledStudents",
        select: "_id userName firstName"
    }).lean();

    const hydratedGroups = await hydrateGroupsWithSubmissions(groups);
    
    res.status(200).json({ Message: "Done", groups: hydratedGroups });
});

export const Bygrade = asyncHandler(async (req, res, next) => {
    const { user, isteacher } = req;
    const { grade } = req.query;

    // RULE: Students cannot use this endpoint.
    if (!isteacher) {
        return next(new Error('Forbidden: You do not have permission to perform this action.', { cause: 403 }));
    }

    const gradeDoc = await gradeModel.findOne({ grade }).lean();
    if (!gradeDoc) {
        return next(new Error(`Grade "${grade}" not found`, { cause: 404 }));
    }

    let query = { gradeid: gradeDoc._id };

    // RULE: Assistants can only see groups within their permissions.
    if (user.role === 'assistant') {
        const permittedGroupIds = user.permissions.groups?.map(id => id.toString()) || [];
        query._id = { $in: permittedGroupIds };
    }
     // RULE: Main teachers have no _id restrictions.

    const groups = await groupModel
        .find(query)
        .populate({
            path: "enrolledStudents",
            select: "_id userName firstName lastName phone email parentPhone"
        }).lean();

    const hydratedGroups = await hydrateGroupsWithSubmissions(groups);

    res.status(200).json({
        Message: "Groups fetched successfully",
        groups: hydratedGroups
    });
});

export const ById = asyncHandler(async (req, res, next) => {
    const { user, isteacher } = req;
    const { _id } = req.query;

    // Authorization Checks
    if (isteacher) {
        // RULE: Assistant must have the group in their permissions.
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.groups?.map(id => id.toString()) || [];
            if (!permittedGroupIds.includes(_id)) {
                return next(new Error('Forbidden: You do not have permission to view this group.', { cause: 403 }));
            }
        }
        // RULE: Main teacher has no restrictions.
    } else {
        // RULE: Student can only view their own group.
        if (!user.groupId || user.groupId.toString() !== _id) {
            return next(new Error('Forbidden: You can only view your own group.', { cause: 403 }));
        }
    }

    // If authorization passes, fetch the data.
    const group = await groupModel.findById(_id).populate({
        path: "enrolledStudents",
        select: "_id userName firstName"
    }).lean();

    if (!group) {
        return next(new Error(`Group with ID "${_id}" not found`, { cause: 404 }));
    }

    // Hydrate a single group (passed as an array)
    const hydratedGroup = await hydrateGroupsWithSubmissions([group]);
    
    res.status(200).json({ Message: "Done", group: hydratedGroup[0] }); // Return the single object
});