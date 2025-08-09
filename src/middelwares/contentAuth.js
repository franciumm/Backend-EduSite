// src/middelwares/contentAuth.js

import { sectionModel } from '../../DB/models/section.model.js';
import { assignmentModel } from '../../DB/models/assignment.model.js';
import { examModel } from '../../DB/models/exams.model.js';
import materialModel from '../../DB/models/material.model.js';
import studentModel from '../../DB/models/student.model.js';
import { toZonedTime } from 'date-fns-tz'; // Import for timezone handling
const contentModels = {
    [CONTENT_TYPES.ASSIGNMENT]: assignmentModel,
    [CONTENT_TYPES.EXAM]: examModel,
    [CONTENT_TYPES.MATERIAL]: materialModel,
};

// --- START: CORRECTED canAccessContent ---
export const canAccessContent = async ({ user, isTeacher, contentId, contentType }) => {
    // 1. Main teacher has universal access. (No changes, this is correct)
    if (isTeacher && user.role === 'main_teacher') {
        return true;
    }

    // 2. Assistant access logic. (No changes, this is correct)
    if (isTeacher && user.role === 'assistant') {
        const Model = contentModels[contentType];
        const content = await Model.findById(contentId).select('groupIds').lean();
        if (!content) return false;

        const permittedGroupIds = user.permissions[contentType + 's']?.map(id => id.toString()) || [];
        if (permittedGroupIds.length === 0) return false;

        const contentGroupIds = content.groupIds.map(id => id.toString());
        return contentGroupIds.some(groupId => permittedGroupIds.includes(groupId));
    }

    // 3. Student access logic (This is where the timeline check is now properly scoped)
       if (!isTeacher) {
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student) return false;

        const Model = contentModels[contentType];
        // --- The "Grand Fetch": Get the content document ONCE ---
        const content = await Model.findById(contentId).lean();
        if (!content) return false;

        // --- The "Grand Check": Verify enrollment and timeline in one logical flow ---

        // Path A: Is the student directly enrolled or in an assigned group?
        const isDirectlyEnrolled = 
            (content.enrolledStudents && content.enrolledStudents.some(id => id.equals(user._id))) ||
            (content.groupIds && student.groupId && content.groupIds.some(id => id.equals(student.groupId)));

        // Path B: If not directly enrolled, is the student enrolled via a linked section?
        let isSectionEnrolled = false;
        if (!isDirectlyEnrolled) {
            const linkField = `linked${contentType.charAt(0).toUpperCase() + contentType.slice(1)}s`;
            const section = await sectionModel.findOne({
                groupIds: student.groupId,
                [linkField]: contentId
            }).select('_id').lean();
            isSectionEnrolled = !!section;
        }
        
        // If the student has no valid enrollment path, deny access immediately.
        if (!isDirectlyEnrolled && !isSectionEnrolled) {
            return false;
        }

        // If enrollment is confirmed, the FINAL check is the timeline.
        return isStudentTimelineValid({ user, content });
    }


    return false; // Default deny
};
// --- END: CORRECTED canAccessContent ---

export const canViewSubmissionsFor = async ({ user, isTeacher, contentId, contentType }) => {
    if (isTeacher && user.role === 'main_teacher') {
        return true;
    }   
        return canAccessContent({ user, isTeacher, contentId, contentType });
}



/**
 * A centralized function to check if the current time is valid for a student
 * to access a given piece of content (assignment or exam).
 * THIS HELPER IS ONLY FOR STUDENTS.
 */
const isStudentTimelineValid = ({ user, content }) => {
    // Check for material (which has no dates) or content with no timeline.
    const mainStartDate = content.startDate || content.startdate;
  
    if (!mainStartDate) {
        return true;
    }
    
    const uaeTimeZone = 'Asia/Dubai';
    const now = toZonedTime(new Date(), uaeTimeZone);
      if (content.publishDate) {
    return new Date(content.publishDate) <= now;
}
    const mainEndDate = content.endDate || content.enddate;
    let effectiveStartDate = mainStartDate;
    let effectiveEndDate = mainEndDate;

    if (content.exceptionStudents && content.exceptionStudents.length > 0) {
        const exception = content.exceptionStudents.find(ex => ex.studentId.equals(user._id));
        if (exception) {
            effectiveStartDate = exception.startdate;
            effectiveEndDate = exception.enddate;
        }
    }
    
    if (content.rejectedStudents && content.rejectedStudents.some(id => id.equals(user._id))) {
        return false;
    }

    if (now < effectiveStartDate) return false;

    if (now > effectiveEndDate) {
        return !!content.allowSubmissionsAfterDueDate;
    }

    return true;
};