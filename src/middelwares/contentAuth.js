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

// --- START: MODIFIED canAccessContent ---
export const canAccessContent = async ({ user, isTeacher, contentId, contentType }) => {
    // 1. Main teacher has universal access.
    if (isTeacher && user.role === 'main_teacher') {
        return true;
    }

    // 2. Assistant access logic.
    if (isTeacher && user.role === 'assistant') {
        const Model = contentModels[contentType];
        const content = await Model.findById(contentId).select('groupIds').lean();
        if (!content) return false;

        // Get the assistant's permitted groups for this content type.
        const permittedGroupIds = user.permissions[contentType + 's']?.map(id => id.toString()) || [];
        if (permittedGroupIds.length === 0) return false;

        // Check if there is an overlap between the content's groups and the assistant's permitted groups.
        const contentGroupIds = content.groupIds.map(id => id.toString());
        return contentGroupIds.some(groupId => permittedGroupIds.includes(groupId));
    }

    // 3. Student access logic (remains unchanged).
    if (!isTeacher) {
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student || !student.groupId) return false;

        const [hasDirectAccess, hasSectionAccess] = await Promise.all([
            checkDirectAccess({ user, contentId, contentType, studentGroupId: student.groupId }),
            checkSectionAccess({ contentId, contentType, studentGroupId: student.groupId })
        ]);
        return hasDirectAccess || hasSectionAccess;
    }

    return false; // Default deny
};
// --- END: MODIFIED canAccessContent ---

export const canViewSubmissionsFor = async ({ user, isTeacher, contentId, contentType }) => {
    // For assistants, we must verify they created the content OR have permission.
    if (isTeacher && user.role === 'main_teacher') {
        return true;
    }
    if (isTeacher && user.role === 'assistant') {
        return canAccessContent({ user, isTeacher, contentId, contentType });
    } 
    if (!isTeacher) {
        return canAccessContent({ user, isTeacher, contentId, contentType });
    }

    

    return false;
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