import { groupModel } from "../../../../DB/models/groups.model.js";
import { SubassignmentModel } from '../../../../DB/models/submitted_assignment.model.js';
import { SubexamModel } from '../../../../DB/models/submitted_exams.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";
import mongoose from 'mongoose';
import { contentStreamModel } from '../../../../DB/models/contentStream.model.js';
import { submissionStatusModel } from '../../../../DB/models/submissionStatus.model.js';
import { pagination } from "../../../utils/pagination.js";


const getAndHydrateGroupsViaAggregation = async (initialMatch, skip=0 , limit=5) => {
    const pipeline = [
        // Stage 1: Initial Filter - Find only the groups the user is allowed to see.
        { $match: initialMatch },

        // Stage 2: Populate Enrolled Students - More performant than .populate()
        {
            $lookup: {
                from: 'students', // The actual collection name for students
                localField: 'enrolledStudents',
                foreignField: '_id',
                as: 'enrolledStudents',
                pipeline: [
                    // We only need specific fields for the final response
                    { $project: { _id: 1, userName: 1, firstName: 1, lastName: 1, phone: 1, email: 1, parentPhone: 1 } }
                ]
            }
        },

        // Stage 3: Deconstruct the students array to process each one individually.
        { $unwind: { path: "$enrolledStudents", preserveNullAndEmptyArrays: true } },

        // Stage 4: Look up all assignment submissions for each student.
        {
            $lookup: {
                from: 'subassignments', // The actual collection name for submitted assignments
                localField: 'enrolledStudents._id',
                foreignField: 'studentId',
                as: 'enrolledStudents.submittedassignments'
            }
        },
        
        // Stage 5: Look up all exam submissions for each student.
        {
            $lookup: {
                from: 'subexams', // The actual collection name for submitted exams
                localField: 'enrolledStudents._id',
                foreignField: 'studentId',
                as: 'enrolledStudents.submittedexams'
            }
        },

        // Stage 6: Reconstruct the groups.
        // This groups the students (who now have their submissions) back into their parent group.
        {
            $group: {
                _id: "$_id",
                groupname: { $first: "$groupname" },
                createdAt: { $first: "$createdAt" },
                updatedAt: { $first: "$updatedAt" },
                // Add students back into an array, but only if they exist
                enrolledStudents: { 
                    $push: { 
                        $cond: [ "$enrolledStudents._id", "$enrolledStudents", "$$REMOVE" ]
                    } 
                }
            }
        },
        // Stage 7: Sort the final groups by creation date.
         { $sort: { createdAt: -1 } },

        // Stage 8: PAGINATION - Skip documents
        { $skip: skip },

        // Stage 9: PAGINATION - Limit documents
        { $limit: limit }
    ];

    return await groupModel.aggregate(pipeline);
};

// --- Refactored & Secured Controller Functions ---


export const getall = asyncHandler(async (req, res, next) => {
    const { user, isteacher } = req;
    
    // Parse query parameters and provide defaults
    const page = parseInt(req.query.page, 10) || 1;
    const size = parseInt(req.query.size, 10) || 10;
    const isArchivedBool = req.query.isArchived === 'true';

    const { limit, skip } = pagination({ page, size });

    // 1. Build the initial match query based on permissions
    const initialMatch = { isArchived: isArchivedBool };

    if (isteacher) {
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.groups?.map(id => new mongoose.Types.ObjectId(id)) || [];
            initialMatch._id = { $in: permittedGroupIds }; 
        }
    } else {
        if (!user.groupIds || user.groupIds.length === 0) {
            return res.status(200).json({ 
                message: "No groups found.",
                data: [],
                total: 0,
                totalPages: 0,
                currentPage: page
            });
        }
        initialMatch._id = { $in: user.groupIds };
    }

    // 2. Create the main aggregation pipeline with $facet
    const aggregationPipeline = [
        { $match: initialMatch },
        {
            $facet: {
                // Pipeline 1: Get the paginated and hydrated data
                paginatedResults: [
                    { $skip: skip },
                    { $limit: limit },
                    // --- This is the "Hydration" part ---
                    // Add any lookups or additional fields you need for the group objects
                    {
                        $addFields: {
                            studentCount: { $size: "$enrolledStudents" }
                        }
                    },
                    {
                        $project: {
                            enrolledStudents: 0, // Exclude the large array from the final response
                            __v: 0
                        }
                    }
                ],
                // Pipeline 2: Get the total count of documents
                totalCount: [
                    { $count: 'count' }
                ]
            }
        }
    ];

    const result = await groupModel.aggregate(aggregationPipeline);

    // 3. Extract data and calculate pagination details
    const hydratedGroups = result[0].paginatedResults;
    const total = result[0].totalCount.length > 0 ? result[0].totalCount[0].count : 0;
    const totalPages = Math.ceil(total / limit);

    // 4. Send the final response
    res.status(200).json({ 
        Message: "Done", 
        groups: hydratedGroups,
        total,
        totalPages,
        currentPage: page
    });
});

export const ById = asyncHandler(async (req, res, next) => {
    const { user, isteacher } = req;
    const { _id } = req.query;

    if (!mongoose.Types.ObjectId.isValid(_id)) {
        return next(new Error(`Invalid Group ID format`, { cause: 400 }));
    }

    const groupId = new mongoose.Types.ObjectId(_id);
    let initialMatch = { _id: groupId };

    if (isteacher) {
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.groups?.map(id => id.toString()) || [];
            if (!permittedGroupIds.includes(_id)) {
                return next(new Error('Forbidden: You do not have permission to view this group.', { cause: 403 }));
            }
        }
    } else {
       const isStudentInGroup = user.groupIds?.some(id => id.equals(groupId));
        if (!isStudentInGroup) {
            return next(new Error('Forbidden: You are not a member of this group.', { cause: 403 }));
        }
    }

    const hydratedGroups = await getAndHydrateGroupsViaAggregation(initialMatch);

    if (!hydratedGroups || hydratedGroups.length === 0) {
        return next(new Error(`Group with ID "${_id}" not found`, { cause: 404 }));
    }
    
    res.status(200).json({ Message: "Done", group: hydratedGroups[0] });
});
