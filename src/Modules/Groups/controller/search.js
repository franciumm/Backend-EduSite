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
    const { page, size,isArchived } = req.query;
    const isArchivedBool = req.query.isArchived === 'true';
    const initialMatch = { isArchived: isArchivedBool };
    const { limit, skip } = pagination({ page, size });


//-----------------------------Permissions Check Logic----------------------------------------------
    if (isteacher) {
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.groups?.map(id => new mongoose.Types.ObjectId(id)) || [];
            initialMatch._id = { $in: permittedGroupIds }; 
        }
    } else {
        if (!user.groupId) {
            return res.status(200).json({ Message: "Done", groups: [] });
        }
        initialMatch._id = user.groupId;
    }


//------------------------------------------Get Groups ----------------------------------------------------------


    const hydratedGroups = await getAndHydrateGroupsViaAggregation(initialMatch, skip, limit);
    res.status(200).json({ Message: "Done", groups: hydratedGroups });
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
        if (!user.groupId || user.groupId.toString() !== _id) {
            return next(new Error('Forbidden: You can only view your own group.', { cause: 403 }));
        }
    }

    const hydratedGroups = await getAndHydrateGroupsViaAggregation(initialMatch);

    if (!hydratedGroups || hydratedGroups.length === 0) {
        return next(new Error(`Group with ID "${_id}" not found`, { cause: 404 }));
    }
    
    res.status(200).json({ Message: "Done", group: hydratedGroups[0] });
});
