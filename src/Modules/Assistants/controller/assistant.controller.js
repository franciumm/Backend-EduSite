// src/Modules/Assistants/controller/assistant.controller.js

import { teacherModel } from "../../../../DB/models/teacher.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";
import bcrypt from 'bcrypt';

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

    const updatedAssistant = await teacherModel.findOneAndUpdate(
        { _id: assistantId, role: 'assistant' }, // Prevents updating other main_teachers
        { $set: { permissions: permissions } },
        { new: true, runValidators: true }
    ).select('-password');
    // ADDED: Robust validation
  
  
    if (!updatedAssistant) {
        return next(new Error("Assistant not found.", { cause: 404 }));
    }

    res.status(200).json({ message: "Assistant permissions updated successfully.", data: updatedAssistant });
});

// Controller to get a list of all assistants
export const getAllAssistants = asyncHandler(async (req, res, next) => {
    const assistants = await teacherModel.find({ role: 'assistant' }).select('-password');
    res.status(200).json({ message: "Assistants fetched successfully.", data: assistants });
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


// Controller to delete an assistant
export const deleteAssistant = asyncHandler(async (req, res, next) => {
    const { assistantId } = req.params;
    const deletedAssistant = await teacherModel.findOneAndDelete({ _id: assistantId, role: 'assistant' });

    if (!deletedAssistant) {
        return next(new Error("Assistant not found.", { cause: 404 }));
    }

    res.status(200).json({ message: "Assistant deleted successfully." });
});