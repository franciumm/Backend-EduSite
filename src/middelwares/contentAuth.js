// src/middelwares/contentAuth.js

import { sectionModel } from '../../DB/models/section.model.js';
import { assignmentModel } from '../../DB/models/assignment.model.js';
import { examModel } from '../../DB/models/exams.model.js';
import materialModel from '../../DB/models/material.model.js';
import studentModel from '../../DB/models/student.model.js';
import { toZonedTime } from 'date-fns-tz'; // Import for timezone handling
import { CONTENT_TYPES } from '../utils/constants.js';
import { contentStreamModel } from '../../DB/models/contentStream.model.js';
const contentModels = {
    
    [CONTENT_TYPES.ASSIGNMENT]: assignmentModel,
    [CONTENT_TYPES.EXAM]: examModel,
    [CONTENT_TYPES.MATERIAL]: materialModel,
};

export const canAccessContent = async ({ user, isTeacher, contentId, contentType }) => {
    // The new logic is incredibly simple and fast.
    // Does a record exist in the stream linking this user to this content?
    const streamEntry = await contentStreamModel.findOne({
        userId: user._id,
        contentId: contentId,
        contentType: contentType
    }).lean();

    // If no entry exists, they are not authorized. Period.
    if (!streamEntry) {
        return false;
    }

    // If an entry exists, they are authorized. Now we just check the timeline for students.
    if (!isTeacher) {
        // We still need the original content document for its dates.
        const contentModels = {
            [CONTENT_TYPES.ASSIGNMENT]: assignmentModel,
            [CONTENT_TYPES.EXAM]: examModel,
            [CONTENT_TYPES.MATERIAL]: materialModel,
        };
        const Model = contentModels[contentType];
           if (!Model) {
        return true;
    }
        const content = await Model.findById(contentId).lean();
        
        // This is a failsafe; content should exist if a stream entry exists.
        if (!content) return false; 

        // The timeline validation logic itself was correct, so we reuse it.
        return isStudentTimelineValid({ user, content });
    }

    // If the user is a teacher and a stream entry exists, they have access.
    return true;
};
// --- END: CORRECTED canAccessContent ---



export const canViewSubmissionsFor = async ({ user, isTeacher, contentId, contentType }) => {
    if (isTeacher && user.role === 'main_teacher') {
        return true;
    }   
        return canAccessContent({ user, isTeacher, contentId, contentType });
}


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