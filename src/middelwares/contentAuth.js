// src/middelwares/contentAuth.js

import { sectionModel } from '../../DB/models/section.model.js';
import { assignmentModel } from '../../DB/models/assignment.model.js';
import { examModel } from '../../DB/models/exams.model.js';
import materialModel from '../../DB/models/material.model.js';
import studentModel from '../../DB/models/student.model.js';

const contentModels = {
    assignment: assignmentModel,
    exam: examModel,
    material: materialModel,
};

export const canAccessContent = async ({ user, isTeacher, contentId, contentType }) => {
    if (isTeacher) return true;

    const student = await studentModel.findById(user._id).select('groupId').lean();
    if (!student) return false;

    const studentGroupId = student.groupId;

    const [hasDirectAccess, hasSectionAccess] = await Promise.all([
        checkDirectAccess({ user, contentId, contentType, studentGroupId }),
        checkSectionAccess({ contentId, contentType, studentGroupId })
    ]);

    return hasDirectAccess || hasSectionAccess;
};

// =================================================================
// --- PHASE 1: New Authorizer for Viewing Submissions ---
// This function checks if a user is allowed to see the submissions for a specific assignment/exam.
// =================================================================
/**
 * @param {object} options
 * @param {object} options.user - The authenticated user object.
 * @param {boolean} options.isTeacher - Flag indicating if the user is a teacher.
 * @param {string} options.contentId - The ID of the parent assignment or exam.
 * @param {string} options.contentType - The type of content ('assignment' or 'exam').
 * @returns {Promise<boolean>} - True if the user can view submissions, false otherwise.
 */
export const canViewSubmissionsFor = async ({ user, isTeacher, contentId, contentType }) => {
    // Rule 1: A teacher can view submissions for content they created.
    if (isTeacher) {
        const Model = contentModels[contentType];
        const content = await Model.findOne({ _id: contentId, createdBy: user._id }).select('_id').lean();
        return !!content;
    }

    // Rule 2: A student can view submissions for content they have access to.
    // This correctly re-uses our existing `canAccessContent` logic, preventing duplication.
    return await canAccessContent({ user, isTeacher, contentId, contentType });
};


// --- Private Helpers (Unchanged) ---
const checkDirectAccess = async ({ user, contentId, contentType, studentGroupId }) => {
    const Model = contentModels[contentType];
    if (!Model) return false;

    const orConditions = [{ enrolledStudents: user._id }];
    if (studentGroupId) {
        orConditions.push({ groupIds: studentGroupId });
    }

    const content = await Model.findOne({ _id: contentId, $or: orConditions }).select('_id').lean();
    return !!content;
};

const checkSectionAccess = async ({ contentId, contentType, studentGroupId }) => {
    if (!studentGroupId) return false;
    const linkField = `linked${contentType.charAt(0).toUpperCase() + contentType.slice(1)}s`;
    
    const section = await sectionModel.findOne({
        groupIds: studentGroupId,
        [linkField]: contentId
    }).select('_id').lean();

    return !!section;
};