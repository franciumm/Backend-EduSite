// src/utils/streamHelpers.js
import mongoose from 'mongoose';
import { contentStreamModel } from '../../DB/models/contentStream.model.js';
import { submissionStatusModel } from '../../DB/models/submissionStatus.model.js';
import studentModel from '../../DB/models/student.model.js';

export const synchronizeContentStreams = async ({ content, oldGroupIds, newGroupIds, session }) => {
    const oldIds = new Set(oldGroupIds.map(id => id.toString()));
    const newIds = new Set(newGroupIds.map(id => id.toString()));

    const addedGroupIds = [...newIds].filter(id => !oldIds.has(id));
    const removedGroupIds = [...oldIds].filter(id => !newIds.has(id));

    // 1. Handle Added Groups: Fan-out to new students
    if (addedGroupIds.length > 0) {
        const studentsToAdd = await studentModel.find({ groupId: { $in: addedGroupIds } }).select('_id groupId').session(session);
        if (studentsToAdd.length > 0) {
            const streamEntries = studentsToAdd.map(student => ({
                userId: student._id, contentId: content._id, contentType: content.constructor.modelName.toLowerCase(),
                gradeId: content.gradeId || content.grade, groupId: student.groupId
            }));
            const statusEntries = studentsToAdd.map(student => ({
                studentId: student._id, contentId: content._id, contentType: content.constructor.modelName.toLowerCase(),
                submissionModel: content.constructor.modelName.toLowerCase() === 'exam' ? 'subexam' : 'subassignment',
                groupId: student.groupId, status: 'assigned'
            }));
            
            await contentStreamModel.insertMany(streamEntries, { session });
            if (['assignment', 'exam'].includes(content.constructor.modelName.toLowerCase())) {
                await submissionStatusModel.insertMany(statusEntries, { session });
            }
        }
    }

    // 2. Handle Removed Groups: Revoke access from old students
    if (removedGroupIds.length > 0) {
        const studentsToRemove = await studentModel.find({ groupId: { $in: removedGroupIds } }).select('_id').session(session);
        const studentIdsToRemove = studentsToRemove.map(s => s._id);

        if (studentIdsToRemove.length > 0) {
            await contentStreamModel.deleteMany({ userId: { $in: studentIdsToRemove }, contentId: content._id }, { session });
            if (['assignment', 'exam'].includes(content.constructor.modelName.toLowerCase())) {
                await submissionStatusModel.deleteMany({ studentId: { $in: studentIdsToRemove }, contentId: content._id }, { session });
            }
        }
    }
};