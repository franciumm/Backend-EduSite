// src/utils/streamHelpers.js
import mongoose from 'mongoose';
import { contentStreamModel } from '../../DB/models/contentStream.model.js';
import { submissionStatusModel } from '../../DB/models/submissionStatus.model.js';
import studentModel from '../../DB/models/student.model.js';

export const synchronizeContentStreams = async ({ content, oldGroupIds = [], newGroupIds = [], session }) => {
    const oldIds = new Set(oldGroupIds.map(id => id.toString()));
    const newIds = new Set(newGroupIds.map(id => id.toString()));

    const addedGroupIds = [...newIds].filter(id => !oldIds.has(id));
    const removedGroupIds = [...oldIds].filter(id => !newIds.has(id));
    const contentType = content.constructor.modelName.toLowerCase();

    // 1. Handle Added Groups: Fan-out access to new students.
    if (addedGroupIds.length > 0) {
        // CORRECTED: Query against the 'groupIds' array.
        const studentsToAdd = await studentModel.find({ groupIds: { $in: addedGroupIds } }).select('_id groupIds').session(session);
        if (studentsToAdd.length > 0) {
            const streamOps = [];
            const statusOps = [];
            const submissionModel = contentType === 'exam' ? 'subexam' : 'subassignment';

            studentsToAdd.forEach(student => {
                // Find which of the newly added groups this student is in
                const relevantGroups = student.groupIds.filter(sgid => addedGroupIds.includes(sgid.toString()));
                relevantGroups.forEach(groupId => {
                    streamOps.push({ updateOne: { filter: { userId: student._id, contentId: content._id, groupId }, update: { $set: { contentType } }, upsert: true } });
                    if (['assignment', 'exam'].includes(contentType)) {
                        statusOps.push({ updateOne: { filter: { studentId: student._id, contentId: content._id, groupId }, update: { $setOnInsert: { contentType, submissionModel, status: 'assigned' } }, upsert: true } });
                    }
                });
            });

            if (streamOps.length > 0) await contentStreamModel.bulkWrite(streamOps, { session });
            if (statusOps.length > 0) await submissionStatusModel.bulkWrite(statusOps, { session });
        }
    }

    // 2. Handle Removed Groups: Revoke access from old students.
    if (removedGroupIds.length > 0) {
        // CORRECTED: Query against the 'groupIds' array.
        const studentsToRemove = await studentModel.find({ groupIds: { $in: removedGroupIds } }).select('_id').session(session);
        const studentIdsToRemove = studentsToRemove.map(s => s._id);

        if (studentIdsToRemove.length > 0) {
            // CORRECTED: The groupId filter is now essential here.
            await contentStreamModel.deleteMany({ userId: { $in: studentIdsToRemove }, contentId: content._id, groupId: { $in: removedGroupIds } }, { session });
            if (['assignment', 'exam'].includes(contentType)) {
                await submissionStatusModel.deleteMany({ studentId: { $in: studentIdsToRemove }, contentId: content._id, groupId: { $in: removedGroupIds } }, { session });
            }
        }
    }
};