// src/Modules/Sections/controller/section.controller.js
import { asyncHandler } from '../../../utils/erroHandling.js';
import { sectionModel } from '../../../../DB/models/section.model.js';
import studentModel from '../../../../DB/models/student.model.js';
import mongoose from 'mongoose';
import { _internalCreateAssignment } from '../../Assignments/controller/start.js';
import { _internalCreateExam } from '../../Exams/controller/Start.js';
import { createMaterial } from '../../Materials/controller/All.js';
import { normalizeContentName } from '../../../utils/queryHelpers.js';
import { pagination } from '../../../utils/pagination.js';
import { CONTENT_TYPES } from '../../../utils/constants.js'; 
import { contentStreamModel } from '../../../../DB/models/contentStream.model.js';
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { toZonedTime } from 'date-fns-tz'; // Import for timezone handling
import { assignmentModel } from '../../../../DB/models/assignment.model.js';
import { examModel } from '../../../../DB/models/exams.model.js';
import materialModel from '../../../../DB/models/material.model.js';

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}


const propagateSectionToStreams = async ({ section, session }) => {
    const students = await studentModel.find({ groupId: { $in: section.groupIds } }).select('_id groupId').session(session);

    const streamEntries = students.map(student => ({
        userId: student._id,
        contentId: section._id,
        contentType: 'section',
        groupId: student.groupId
    }));

    // Add access for the teacher who created it
    streamEntries.push({
        userId: section.createdBy,
        contentId: section._id,
        contentType: 'section',
    });

    if (streamEntries.length > 0) {
        await contentStreamModel.insertMany(streamEntries, { session });
    }
};

export const _internalCreateSection = async ({ name, description, groupIds, teacherId, itemsToAdd }) => {
  
    if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
        throw new Error("At least one valid Group ID is required to create a section.");
    }
    
    const session = await mongoose.startSession();
    
    try {
        session.startTransaction();

        // 2. Uniqueness check: Ensure the section name is unique within any of the target groups.
        const existingSection = await sectionModel.findOne({ name, groupIds: { $in: groupIds } }).session(session);
        if (existingSection) {
            throw new Error("A section with this name already exists for one of the selected groups. Please choose a different name.");
        }

        // --- NEW: Logic to handle optional initial linking ---
        const initialLinkedContent = {};
        if (itemsToAdd && Array.isArray(itemsToAdd) && itemsToAdd.length > 0) {
            const capitalize = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : '';

            itemsToAdd.forEach(item => {
                // Basic validation for each item in the array
                if (item && item.type && item.id && mongoose.Types.ObjectId.isValid(item.id)) {
                    const fieldName = `linked${capitalize(item.type)}s`;
                    
                    if (!initialLinkedContent[fieldName]) {
                        initialLinkedContent[fieldName] = [];
                    }
                    // Add the ID, ensuring no duplicates within the initial payload
                    if (!initialLinkedContent[fieldName].includes(item.id)) {
                        initialLinkedContent[fieldName].push(item.id);
                    }
                }
            });
        }
        // --- End of new logic ---

        const [section] = await sectionModel.create([{
            name, 
            description, 
            groupIds,
            createdBy: teacherId,
            ...initialLinkedContent
        }], { session });

        await propagateSectionToStreams({ section, session });

        await session.commitTransaction();
        return section;
    } catch (error) {
        await session.abortTransaction();
        // Re-throw to be handled by the calling asyncHandler
        throw error;
    } finally {
        await session.endSession();
    }
};


export const createSection = asyncHandler(async (req, res, next) => {
          const { user, isteacher } = req;
    const { groupIds } = req.body;

    // 1. Block non-teachers immediately.
    if (!isteacher) {
        return next(new Error("Forbidden: You do not have permission to create sections.", { cause: 403 }));
    }

    // 2. Handle Assistant Role: Check permissions before proceeding.
    if (user.role === 'assistant') {
        const permittedGroupIds = user.permissions.sections?.map(id => id.toString()) || [];

        // Check if the assistant has any section permissions at all.
        if (permittedGroupIds.length === 0) {
            return next(new Error("Forbidden: You are not authorized to create sections for any group.", { cause: 403 }));
        }

        // Check if every groupID in the request is included in the assistant's permissions.
        const isAllowed = groupIds.every(reqGroupId => permittedGroupIds.includes(reqGroupId));
        if (!isAllowed) {
            return next(new Error("Forbidden: You do not have permission to create a section for one or more of the selected groups.", { cause: 403 }));
        }
    }
    const newSection = await _internalCreateSection({
        ...req.body,
        teacherId: req.user._id,
    });
    res.status(201).json({ message: "Section container created successfully.", data: newSection });
});
export const updateSectionLinks = asyncHandler(async (req, res, next) => {
    const { sectionId } = req.params;
    const { itemsToAdd, itemsToRemove } = req.body; 
    const {  isteacher } = req;
   

    // 1. Block non-teachers immediately.
    if (!isteacher) {
        return next(new Error("Forbidden: You do not have permission to create sections.", { cause: 403 }));
    }

    // 2. Handle Assistant Role: Check permissions before proceeding.
   
    const updateOperations = { $addToSet: {}, $pull: {} };
    function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

    if (itemsToAdd && itemsToAdd.length > 0) {
        itemsToAdd.forEach(item => {
            const field = `linked${capitalize(item.type)}s`;
            if (!updateOperations.$addToSet[field]) {
                updateOperations.$addToSet[field] = { $each: [] };
            }
            updateOperations.$addToSet[field].$each.push(item.id);
        });
    }
    if (itemsToRemove && itemsToRemove.length > 0) {
        itemsToRemove.forEach(item => {
            const field = `linked${capitalize(item.type)}s`;
            if (!updateOperations.$pull[field]) {
                updateOperations.$pull[field] = { $in: [] };
            }
            updateOperations.$pull[field].$in.push(item.id);
        });
    }

    if (Object.keys(updateOperations.$addToSet).length === 0 && Object.keys(updateOperations.$pull).length === 0) {
        return next(new Error("No valid items provided to add or remove.", { cause: 400 }));
    }
    
    const updatedSection = await sectionModel.findByIdAndUpdate(sectionId, updateOperations, { new: true } );
    if (!updatedSection) {
        return next(new Error("Section not found.", { cause: 404 }));
    }
    res.status(200).json({ message: "Section updated successfully.", data: updatedSection });
});
const buildContentMap = (inputArray, type) => ({
    $map: {
        input: inputArray,
        as: "item",
        in: {
            id: "$$item._id",
            name: { $ifNull: ["$$item.name", "$$item.Name"] },
            type: type
        }
    }
});
export const viewSectionById = asyncHandler(async (req, res, next) => {
    const { sectionId } = req.params;  
    const {user,isteacher} = req;
    const uaeTimeZone = 'Asia/Dubai';
    const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
        const hasAccess = await canAccessContent({
        user,
        isTeacher: isteacher,
        contentId: sectionId,
        contentType: CONTENT_TYPES.SECTION
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to view this section.", { cause: 403 }));
    }
 
  
    const aggregation = [
        { $match: { _id: new mongoose.Types.ObjectId(sectionId) } },
        { $lookup: { from: 'assignments', localField: 'linkedAssignments', foreignField: '_id', as: 'assignments' } },
        { $lookup: { from: 'exams', localField: 'linkedExams', foreignField: '_id', as: 'exams' } },
        { $lookup: { from: 'materials', localField: 'linkedMaterials', foreignField: '_id', as: 'materials' } },
        { $lookup: { from: 'sections', localField: 'linkedSections', foreignField: '_id', as: 'nestedSections' } },
              {
            $addFields: {
                materials: {
                    $cond: {
                        if: isteacher,
                        then: "$materials",
                        else: {
                            $filter: {
                                input: "$materials",
                                as: "item",
                                cond: {
                                    $or: [
                                        { $not: ["$$item.publishDate"] },
                                        { $eq: ["$$item.publishDate", null] },
                                        { $lte: ["$$item.publishDate", nowInUAE] }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        },
        {
            $project: {
                _id: 1, name: 1, description: 1,
                content: {
                    $concatArrays: [
                        buildContentMap("$assignments", CONTENT_TYPES.ASSIGNMENT),
                        buildContentMap("$exams", CONTENT_TYPES.EXAM),
                        buildContentMap("$materials", CONTENT_TYPES.MATERIAL)
                    ]
                }
            }
        }
    ];
    const results = await sectionModel.aggregate(aggregation);
    if (results.length === 0) {
        return next(new Error("Section not found", { cause: 404 }));
    }
    res.status(200).json({ message: "Section content fetched successfully.", data: results[0] });
});


export const deleteSection = asyncHandler(async (req, res, next) => {
    const { sectionId } = req.params;

    // A transaction is still crucial to ensure the entire operation is atomic.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Step 1: Fetch the section document to perform checks.
        const section = await sectionModel.findById(sectionId).session(session);

        if (!section) {
            await session.abortTransaction(); // No need to continue if not found
            return next(new Error("Section not found.", { cause: 404 }));
        }

        // Step 2: Perform authorization checks (Controller's responsibility).
        const isMainTeacher = req.user.role === 'main_teacher';
        const isOwner = section.createdBy.equals(req.user._id);

        if (!isMainTeacher && !isOwner) {
            await session.abortTransaction();
            return next(new Error("Forbidden: You are not authorized to delete this section.", { cause: 403 }));
        }

        // Step 3: Trigger the deletion. The pre('deleteOne') hook will now run automatically.
        await section.deleteOne({ session });

        // Step 4: If the hook succeeds, commit the transaction.
        await session.commitTransaction();

        res.status(200).json({ message: "Section deleted successfully." });

    } catch (error) {
        // If any error occurred (either here or in the hook), abort the transaction.
        await session.abortTransaction();
        console.error("Section deletion failed:", error); 
        return next(new Error("Failed to delete section and its content. The operation was rolled back.", { cause: 500 }));
    } finally {
        // Always end the session.
        await session.endSession();
    }
});


export const getSections = asyncHandler(async (req, res, next) => {
    // 1. Initial setup from request
    const { page = 1, size = 10, groupId } = req.query;
    const { user, isteacher } = req;
    const isTeacher = isteacher;
    const { limit, skip } = pagination({ page, size });
  const streamItems = await contentStreamModel.find({
        userId: user._id,
        contentType: 'section'
    }).lean();

    
    const sectionIds = streamItems.map(item => item.contentId);

    if (sectionIds.length === 0) {
        return res.status(200).json({ message: "No sections found.", data: [], total: 0, totalPages: 0, currentPage: parseInt(page, 10) });
    }

    let query = { _id: { $in: sectionIds } };


    if (groupId) {
        if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("A valid Group ID is required.", { cause: 400 }));
        // This checks if the section is linked to the specified group.
        query.groupIds = groupId;
    }




       // 4. Fetch the data with pagination.
    const [sections, totalSections] = await Promise.all([
        sectionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        sectionModel.countDocuments(query)
    ]);

    // 5. Return the response, preserving the original structure.
    return res.status(200).json({
        message: "Sections fetched successfully",
        data: sections,
        total: totalSections,
        totalPages: Math.ceil(totalSections / limit),
        currentPage: parseInt(page, 10),
    });
  
});
