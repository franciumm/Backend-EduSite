// src/Modules/Assistants/controller/assistant.controller.js

import { teacherModel } from "../../../../DB/models/teacher.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";
import bcrypt from 'bcrypt';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import mongoose from "mongoose";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import materialModel from "../../../../DB/models/material.model.js";

const rebuildAssistantStream = async ({ assistantId, newPermissions, session }) => {
    // 1. Delete all of the assistant's old stream entries
    await contentStreamModel.deleteMany({ userId: assistantId }, { session });

    // 2. Get a unique list of all group IDs the assistant now has access to
    const allGroupIds = new Set();
    Object.values(newPermissions).forEach(idArray => {
        if (Array.isArray(idArray)) {
            idArray.forEach(id => allGroupIds.add(id.toString()));
        }
    });
    if (allGroupIds.size === 0) return; // Nothing more to do

    const groupIds = Array.from(allGroupIds).map(id => new mongoose.Types.ObjectId(id));
    
    // 3. Find all content linked to those groups
    const [assignments, exams, materials, sections] = await Promise.all([
        assignmentModel.find({ groupIds: { $in: groupIds } }).select('_id gradeId').session(session),
        examModel.find({ groupIds: { $in: groupIds } }).select('_id grade').session(session),
        materialModel.find({ groupIds: { $in: groupIds } }).select('_id gradeId').session(session),
        sectionModel.find({ groupIds: { $in: groupIds } }).select('_id gradeId').session(session),
    ]);

    // 4. Create the new stream entries
    const streamEntries = [
        ...assignments.map(a => ({ userId: assistantId, contentId: a._id, contentType: 'assignment', gradeId: a.gradeId })),
        ...exams.map(e => ({ userId: assistantId, contentId: e._id, contentType: 'exam', gradeId: e.grade })),
        ...materials.map(m => ({ userId: assistantId, contentId: m._id, contentType: 'material', gradeId: m.gradeId })),
        ...sections.map(s => ({ userId: assistantId, contentId: s._id, contentType: 'section', gradeId: s.gradeId })),
    ];
    
    if (streamEntries.length > 0) {
        await contentStreamModel.insertMany(streamEntries, { session });
    }
};
// Controller for the Main Teacher to create a new assistant account
export const createAssistant = asyncHandler(async (req, res, next) => {
    const { name, email, password } = req.body;

    // ADDED: Robust validation
    if (!name || !email || !password) {
        return next(new Error("Name, email, and password are required.", { cause: 400 }));
    }

    const emailExists = await teacherModel.findOne({ email });
    if (emailExists) {
        return next(new Error("An account with this email already exists.", { cause: 409 }));
    }

    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.HASH_ROUNDS));

    const newAssistant = await teacherModel.create({
        name,
        email,
        password: hashedPassword,
        role: 'assistant',
        permissions: {
            assignments: [],
            exams: [],
            materials: []
        }
    });

    const assistantData = newAssistant.toObject();
    delete assistantData.password;

    res.status(201).json({ message: "Assistant account created successfully.", data: assistantData });
});

// Controller to update an assistant's permissions
export const updateAssistantPermissions = asyncHandler(async (req, res, next) => {
    const { assistantId } = req.params;
    const { permissions } = req.body;
      if (!permissions || typeof permissions !== 'object') {
        return next(new Error("A valid permissions object is required.", { cause: 400 }));
    }
    const session = await mongoose.startSession();
  try {
        session.startTransaction();

        const updatedAssistant = await teacherModel.findOneAndUpdate(
            { _id: assistantId, role: 'assistant' },
            { $set: { permissions: permissions } },
            { new: true, runValidators: true, session }
        ).select('-password');
        
        if (!updatedAssistant) {
            throw new Error("Assistant not found.", { cause: 404 });
        }

        // *** NEW STEP: Rebuild the content stream based on the new permissions ***
        await rebuildAssistantStream({ assistantId, newPermissions: updatedAssistant.permissions, session });

        await session.commitTransaction();
        res.status(200).json({ message: "Assistant permissions updated successfully.", data: updatedAssistant });

    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});

export const getAllAssistants = asyncHandler(async (req, res, next) => {
    // 1. Fetch all assistants. We use .lean() for performance as we are only reading data.
    const assistants = await teacherModel.find({ role: 'assistant' }).select('-password').lean();

    if (!assistants.length) {
        return res.status(200).json({ message: "No assistants found.", data: [] });
    }

    // 2. Gather all unique Group IDs from all assistants' permissions into a Set.
    // A Set is used to automatically handle duplicates efficiently.
    const allGroupIds = new Set();
    for (const assistant of assistants) {
        // Check if permissions object and its properties exist and are arrays
        if (assistant.permissions) {
            Object.values(assistant.permissions).forEach(permissionArray => {
                if (Array.isArray(permissionArray)) {
                    permissionArray.forEach(id => allGroupIds.add(id.toString()));
                }
            });
        }
    }

    // If there are no groups to populate, we can return the assistants as is.
    if (allGroupIds.size === 0) {
        return res.status(200).json({ message: "Assistants fetched successfully.", data: assistants });
    }

    // 3. Perform ONE efficient query to get all required groups and their associated grades.
    const groups = await groupModel.find({
        _id: { $in: Array.from(allGroupIds) }
    }).populate({
        path: 'gradeid', // Ensure this path matches your groups.model.js schema
        select: 'grade', // Select only the 'grade' number
    }).lean();

    // 4. Create a Map for instant O(1) lookups (ID -> Full Group Object).
    // This is much faster than repeatedly searching the 'groups' array in a loop.
    const groupMap = new Map(groups.map(group => [group._id.toString(), group]));

    // 5. Build the new, populated permissions object for each assistant.
    const populatedAssistants = assistants.map(assistant => {
        const populatedPermissions = {};
        
        if (assistant.permissions) {
            for (const [permissionType, idArray] of Object.entries(assistant.permissions)) {
                if (Array.isArray(idArray)) {
                    populatedPermissions[permissionType] = idArray.map(id => {
                        const group = groupMap.get(id.toString());
                        
                        // Safety check: handle cases where a group or its grade might have been deleted.
                        if (!group || !group.gradeid) {
                            return null;
                        }
                        
                        // 6. Shape the data exactly as requested.
                        return {
                            groupId: group._id,
                            groupname: group.groupname,
                            grade: group.gradeid.grade
                        };
                    }).filter(Boolean); // .filter(Boolean) elegantly removes any nulls from the array.
                }
            }
        }
        
        // Return a new assistant object with the populated permissions
        return {
            ...assistant,
            permissions: populatedPermissions
        };
    });

    res.status(200).json({ message: "Assistants fetched successfully.", data: populatedAssistants });
});
// Controller to get a single assistant by ID
export const getAssistantById = asyncHandler(async (req, res, next) => {
    const { assistantId } = req.params;
    const assistant = await teacherModel.findById(assistantId).select('-password');
    if (!assistant) {
        return next(new Error("Assistant not found.", { cause: 404 }));
    }
    res.status(200).json({ message: "Assistant fetched successfully.", data: assistant });
});


export const deleteAssistant = asyncHandler(async (req, res, next) => {
    const { assistantId } = req.params;

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const deletedAssistant = await teacherModel.findOneAndDelete({ _id: assistantId, role: 'assistant' }, { session });
        if (!deletedAssistant) {
            throw new Error("Assistant not found.", { cause: 404 });
        }
        
        // *** NEW STEP: Clean up the assistant's content stream ***
        await contentStreamModel.deleteMany({ userId: assistantId }, { session });
        
        await session.commitTransaction();
        res.status(200).json({ message: "Assistant deleted successfully." });
    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});