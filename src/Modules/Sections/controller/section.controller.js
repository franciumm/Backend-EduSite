// src/Modules/Sections/controller/section.controller.js

import { asyncHandler } from '../../../utils/erroHandling.js';
import { sectionModel } from '../../../../DB/models/section.model.js';
import { gradeModel } from "../../../../DB/models/grades.model.js";
import studentModel from '../../../../DB/models/student.model.js';
import mongoose from 'mongoose';
import { _internalCreateAssignment } from '../../Assignments/controller/start.js';
import { _internalCreateExam } from '../../Exams/controller/Start.js';
import { _internalCreateMaterial } from '../../Materials/controller/All.js';
import { normalizeContentName } from '../../../utils/queryHelpers.js';
import { pagination } from '../../../utils/pagination.js';
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
// =================================================================
// --- PHASE 2, FIX 2.1: Internal Section Creation Logic (The "Spoke") ---
// =================================================================
export const _internalCreateSection = async ({ name, description, gradeId, groupIds, teacherId }) => {
    // 1. Validate all incoming IDs. This is important for a reusable function.
    
    if (!gradeId || !mongoose.Types.ObjectId.isValid(gradeId)) {
        throw new Error("A valid Grade ID is required to create a section.");
    }
    if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
        throw new Error("At least one valid Group ID is required to create a section.");
    }
    
    // 2. Check for uniqueness to prevent duplicate section names within the same grade.
    const existingSection = await sectionModel.findOne({ name, gradeId });
    if (existingSection) {
        throw new Error("A section with this name already exists for this grade. Please choose a different name.");
    }

    // 3. Create the section document.
    const section = await sectionModel.create({
        name,
        description,
        gradeId,
        groupIds,
        createdBy: teacherId,
        // Linked content arrays are initialized as empty.
        linkedAssignments: [],
        linkedExams: [],
        linkedMaterials: [],
        linkedSections: [],
    });

    return section;
};

/**
 * The original endpoint controller, now a thin wrapper around the internal logic.
 */
export const createSection = asyncHandler(async (req, res, next) => {
    const newSection = await _internalCreateSection({
        ...req.body,
        teacherId: req.user._id,
    });
    res.status(201).json({ message: "Section container created successfully.", data: newSection });
});


// ... (updateSectionLinks, viewSectionById, deleteSection remain unchanged)
export const updateSectionLinks = asyncHandler(async (req, res, next) => {
    const { sectionId } = req.params;
    const { itemsToAdd, itemsToRemove } = req.body; 

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
    const sectionForAuth = await sectionModel.findById(sectionId).select('groupIds').lean();
    if (!sectionForAuth) {
        return next(new Error("Section not found", { cause: 404 }));
    }
    if (req.isteacher.teacher === false) {
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
                _id: 1, name: 1, description: 1,
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


export const createAndLinkContent = asyncHandler(async (req, res, next) => {
    const { sectionId } = req.params;
    const { type, data } = req.body;
    
    // Validation for type and data remains the same
    if (!type || !['assignment', 'exam', 'material', 'section'].includes(type)) { // Added 'section' to valid types
        return next(new Error("A valid 'type' (assignment, exam, material, section) is required.", { cause: 400 }));
    }
    if (!data) {
        return next(new Error("A 'data' object with content details is required.", { cause: 400 }));
    }

    let contentData;
    try {
        contentData = JSON.parse(data);
    } catch (error) {
        return next(new Error("The 'data' field must be a valid JSON string.", { cause: 400 }));
    }
    
    const section = await sectionModel.findById(sectionId);
    if (!section) {
        return next(new Error("The parent section was not found.", { cause: 404 }));
    }
    
    // Default the new content's grade and groups to the parent section's settings for consistency
    contentData.gradeId = contentData.gradeId || section.gradeId;
    contentData.groupIds = contentData.groupIds || section.groupIds;
    contentData.teacherId = req.user._id;

    // Handle file uploads based on type
    if (type === 'material') {
        if (!req.files?.materialFiles || req.files.materialFiles.length === 0) return next(new Error("At least one file is required for materials.", { cause: 400 }));
        contentData.files = req.files.materialFiles;
    } else if (type === 'assignment' || type === 'exam') {
        if (!req.files?.[`${type}File`] || req.files[`${type}File`].length === 0) return next(new Error(`A file is required for an ${type}.`, { cause: 400 }));
        contentData.file = req.files[`${type}File`][0];
    }
    // Note: Creating a section does not require a file upload.

    let createdContent;
    try {
        switch (type) {
            case 'material':
                createdContent = await _internalCreateMaterial(contentData);
                break;
            case 'assignment':
                createdContent = await _internalCreateAssignment(contentData);
                break;
            case 'exam':
                contentData.Name = contentData.name;
                contentData.startdate = contentData.startDate;
                contentData.enddate = contentData.endDate;
                createdContent = await _internalCreateExam(contentData);
                break;
            // --- ADDED THIS CASE ---
            case 'section':
                createdContent = await _internalCreateSection(contentData);
                break;
            default:
                return next(new Error("Invalid content type.", { cause: 400 }));
        }
    } catch (creationError) {
        return next(creationError);
    }

    // Link the new content to the parent section
    const linkFieldName = `linked${capitalize(type)}s`;
    section[linkFieldName].push(createdContent._id);
    await section.save();

    res.status(201).json({
        message: `${type} created and linked to the section successfully.`,
        createdContent,
        updatedSection: section
    });
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
        if (gradeId) {
             if (!mongoose.Types.ObjectId.isValid(gradeId)) {
                return next(new Error("A valid Grade ID is required.", { cause: 400 }));
            }
            query.gradeId = gradeId;
        }
        if (groupId) {
            if (!mongoose.Types.ObjectId.isValid(groupId)) {
                return next(new Error("A valid Group ID is required.", { cause: 400 }));
            }
            query.groupIds = groupId;
        }

        [sections, totalSections] = await Promise.all([
            sectionModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            sectionModel.countDocuments(query)
        ]);
    } 
    // 3. Student Logic: Access based on group membership
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
