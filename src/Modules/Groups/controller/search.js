import { gradeModel } from '../../../../DB/models/grades.model.js';
import { groupModel } from "../../../../DB/models/groups.model.js";
import { SubassignmentModel } from '../../../../DB/models/submitted_assignment.model.js';
import { SubexamModel } from '../../../../DB/models/submitted_exam.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";

// --- Helper Function for the "Aggregate & Hydrate" Pattern ---
const hydrateGroupsWithSubmissions = async (groups) => {
    // 1. Aggregate all student IDs from the groups
    const studentIds = groups.flatMap(group => group.enrolledStudents.map(student => student._id));
    if (studentIds.length === 0) {
        return groups; // No students, no need to fetch submissions
    }

    // 2. Fetch all submissions for these students in parallel (highly performant)
    const [assignmentSubmissions, examSubmissions] = await Promise.all([
        SubassignmentModel.find({ studentId: { $in: studentIds } }).select('studentId assignmentId').lean(),
        SubexamModel.find({ studentId: { $in: studentIds } }).select('studentId examId').lean()
    ]);

    // 3. Create Maps for ultra-fast lookups (O(1) average time complexity)
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

    // 4. Hydrate the original student objects with their submission data
    groups.forEach(group => {
        group.enrolledStudents.forEach(student => {
            const studentIdStr = student._id.toString();
            student.submittedassignments = assgSubmissionsMap.get(studentIdStr) || [];
            student.submittedexams = examSubmissionsMap.get(studentIdStr) || [];
        });
    });

    return groups;
};

// --- Refactored Controller Functions ---

export const getall = asyncHandler(async (req, res, next) => {
    // Fetch primary data
    const groups = await groupModel.find().populate({
        path: "enrolledStudents",
        select: "_id userName firstName"
    }).lean(); // Use .lean() for performance

    // Hydrate with submission details
    const hydratedGroups = await hydrateGroupsWithSubmissions(groups);
    
    res.status(200).json({ Message: "Done", groups: hydratedGroups });
});

export const Bygrade = asyncHandler(async (req, res, next) => {
    const { grade } = req.query;

    const gradeDoc = await gradeModel.findOne({ grade }).lean();
    if (!gradeDoc) {
        return next(new Error(`Grade "${grade}" not found`, { cause: 404 }));
    }

    // Fetch primary data
    const groups = await groupModel
        .find({ gradeid: gradeDoc._id })
        .populate({
            path: "enrolledStudents",
            select: "_id userName firstName lastName phone email parentPhone"
        }).lean();

    // Hydrate with submission details using our helper
    const hydratedGroups = await hydrateGroupsWithSubmissions(groups);

    res.status(200).json({
        Message: "Groups fetched successfully",
        groups: hydratedGroups
    });
});

export const ById = asyncHandler(async (req, res, next) => {
    const { _id } = req.query;

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