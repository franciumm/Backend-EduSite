// src/Modules/Sections/controller/section.controller.js

import { asyncHandler } from '../../../utils/erroHandling.js';
import { sectionModel } from '../../../../DB/models/section.model.js';
import { gradeModel } from "../../../../DB/models/grades.model.js";
import studentModel from '../../../../DB/models/student.model.js';
import mongoose from 'mongoose';
import { _internalCreateAssignment } from '../../Assignments/controller/start.js';
import { _internalCreateExam } from '../../Exams/controller/Start.js';
import { createMaterial } from '../../Materials/controller/All.js';
import { normalizeContentName } from '../../../utils/queryHelpers.js';
import { pagination } from '../../../utils/pagination.js';


function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export const _internalCreateSection = async ({ name, description, gradeId, groupIds, teacherId, itemsToAdd }) => {
    // 1. Validation for core fields remains the same.
    if (!gradeId || !mongoose.Types.ObjectId.isValid(gradeId)) {
        throw new Error("A valid Grade ID is required to create a section.");
    }
    if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
        throw new Error("At least one valid Group ID is required to create a section.");
    }
    
    // 2. Uniqueness check remains the same.
    const existingSection = await sectionModel.findOne({ name, gradeId });
    if (existingSection) {
        throw new Error("A section with this name already exists for this grade. Please choose a different name.");
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

    // 3. Create the section document, now spreading the initial links.
    // If `initialLinkedContent` is empty, this does nothing. If it has content,
    // it will add fields like `linkedAssignments: [...]` to the creation object.
    const section = await sectionModel.create({
        name,
        description,
        gradeId,
        groupIds,
        createdBy: teacherId,
        ...initialLinkedContent
    });

    return section;
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
    const { user, isteacher } = req;
   

    // 1. Block non-teachers immediately.
    if (!isteacher) {
        return next(new Error("Forbidden: You do not have permission to create sections.", { cause: 403 }));
    }
 if (user.role === 'assistant') {
     const ishe = await sectionModel.findById(sectionId );
        const permittedGroupIds = user.permissions.sections?.map(id => id.toString()) || [];

        // Check if the assistant has any section permissions at all.
        if (permittedGroupIds.length === 0) {
            return next(new Error("Forbidden: You are not authorized to create sections for any group.", { cause: 403 }));
        }

        // Check if every groupID in the request is included in the assistant's permissions.
        const isAllowed =  permittedGroupIds.includes(ishe.createdBy);
        if (!isAllowed) {
            return next(new Error("Forbidden: You do not have permission to create a section for one or more of the selected groups.", { cause: 403 }));
        }
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
    const sectionForAuth = await sectionModel.findById(sectionId).select('groupIds gradeId').lean();
    if (!sectionForAuth) {
        return next(new Error("Section not found", { cause: 404 }));
    } 
    if (user.role === 'assistant') {
     const ishe = await sectionModel.findById(sectionId );
        const permittedGroupIds = user.permissions.sections?.map(id => id.toString()) || [];

        // Check if the assistant has any section permissions at all.
        if (permittedGroupIds.length === 0) {
            return next(new Error("Forbidden: You are not authorized to create sections for any group.", { cause: 403 }));
        }

        // Check if every groupID in the request is included in the assistant's permissions.
        const isAllowed =  permittedGroupIds.includes(ishe.createdBy);
        if (!isAllowed) {
            return next(new Error("Forbidden: You do not have permission to create a section for one or more of the selected groups.", { cause: 403 }));
        }
    }else if (req.isteacher.teacher === false) {
        const student = await studentModel.findById(req.user._id).select('groupId').lean();
        if (!student?.groupId || !sectionForAuth.groupIds.map(id => id.toString()).includes(student.groupId.toString())) {
            return next(new Error("You are not authorized to view this section.", { cause: 403 }));
        }
    }

    const aggregation = [
        { $match: { _id: new mongoose.Types.ObjectId(sectionId) } },
        { $lookup: { from: 'assignments', localField: 'linkedAssignments', foreignField: '_id', as: 'assignments' } },
        { $lookup: { from: 'exams', localField: 'linkedExams', foreignField: '_id', as: 'exams' } },
        { $lookup: { from: 'materials', localField: 'linkedMaterials', foreignField: '_id', as: 'materials' } },
        { $lookup: { from: 'sections', localField: 'linkedSections', foreignField: '_id', as: 'nestedSections' } },
        {
            $project: {
                _id: 1, name: 1, description: 1,gradeId: 1,
                content: {
                    $concatArrays: [
                        buildContentMap("$assignments", "assignment"),
                        buildContentMap("$exams", "exam"),
                        buildContentMap("$materials", "material"),
                        buildContentMap("$nestedSections", "section")
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
     const isMainTeacher = req.user.role === 'main_teacher';
    const isOwner = sectionModel.createdBy.equals(req.user._id);
     if (!isMainTeacher && !isOwner) {
        return next(new Error("You are not authorized to delete this assignment.", { cause: 403 }));
    }

    
    // Using findOneAndDelete will correctly trigger the 'pre' hook we defined on the model
    const section = await sectionModel.findOneAndDelete({
        _id: sectionId,
        createdBy: req.user._id
    });

    if (!section) {
        return next(new Error("Section not found or you are not authorized to delete it.", { cause: 404 }));
    }

    res.status(200).json({ message: "Section container deleted successfully." });
});

export const getSections = asyncHandler(async (req, res, next) => {
    // 1. Initial setup from request
    const { page = 1, size = 10, groupId, gradeId } = req.query;
    const { user, isteacher } = req;
    const isTeacher = isteacher.teacher;
    const { limit, skip } = pagination({ page, size });

    let query = {};
    let totalSections = 0;
    let sections = [];

    // 2. Teacher Logic: Broad filtering capabilities
    if (isTeacher) {
    // --- START: NEW ASSISTANT LOGIC ---
        if (user.role === 'main_teacher') {
            // Main teacher logic is unchanged
            if (gradeId) {
                if (!mongoose.Types.ObjectId.isValid(gradeId)) return next(new Error("A valid Grade ID is required.", { cause: 400 }));
                query.gradeId = gradeId;
            }
            if (groupId) {
                if (!mongoose.Types.ObjectId.isValid(groupId)) return next(new Error("A valid Group ID is required.", { cause: 400 }));
                query.groupIds = groupId;
            }
        } else if (user.role === 'assistant') {
            // An assistant sees a section if it's assigned to any group they have *any* permissions for.
            const { assignments = [], exams = [], materials = [] } = user.permissions;
            const allPermittedGroups = [...new Set([...assignments, ...exams, ...materials])]; // Get unique group IDs

            if (allPermittedGroups.length === 0) {
                return res.status(200).json({ message: "No sections found.", data: [], total: 0, totalPages: 0, currentPage: parseInt(page, 10) });
            }
            query = { groupIds: { $in: allPermittedGroups } };
        }

        [sections, totalSections] = await Promise.all([
            sectionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            sectionModel.countDocuments(query)
        ]);
    } 
    else {
        const student = await studentModel.findById(user._id).select('groupId').lean();

        if (!student || !student.groupId) {
            return res.status(200).json({
                message: "No sections found for this student.",
                data: [],
                total: 0,
                totalPages: 0,
                currentPage: parseInt(page, 10)
            });
        }
        
        query = { groupIds: student.groupId };
         if (gradeId) {
            if (!mongoose.Types.ObjectId.isValid(gradeId)) {
                return next(new Error("A valid Grade ID is required.", { cause: 400 }));
            }
            query.gradeId = gradeId;
        }
        
        [sections, totalSections] = await Promise.all([
            sectionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            sectionModel.countDocuments(query)
        ]);
    }

    // 4. Final paginated response
    return res.status(200).json({
        message: "Sections fetched successfully",
        data: sections,
        total: totalSections,
        totalPages: Math.ceil(totalSections / limit),
        currentPage: parseInt(page, 10),
    });
});
