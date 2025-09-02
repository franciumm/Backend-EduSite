import crypto from 'crypto'; 
import {groupModel}from "../../../../DB/models/groups.model.js";
import studentModel from '../../../../DB/models/student.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";
import mongoose from 'mongoose';
import { contentStreamModel } from '../../../../DB/models/contentStream.model.js';
import { submissionStatusModel } from '../../../../DB/models/submissionStatus.model.js';
import { assignmentModel } from '../../../../DB/models/assignment.model.js';
import { examModel } from '../../../../DB/models/exams.model.js';
import materialModel from '../../../../DB/models/material.model.js';
import { sectionModel } from '../../../../DB/models/section.model.js';

const fanOutContentToStudent = async ({ studentId, groupId, session }) => {
    const [assignments, exams, materials, sections] = await Promise.all([
        assignmentModel.find({ groupIds: groupId }).select('_id').session(session),
        examModel.find({ groupIds: groupId }).select('_id').session(session),
        materialModel.find({ groupIds: groupId }).select('_id').session(session),
        sectionModel.find({ groupIds: groupId }).select('_id').session(session),
    ]);

    // Build operations for ContentStream
    const streamOps = [
        ...assignments.map(a => ({ updateOne: { filter: { userId: studentId, contentId: a._id }, update: { $set: { contentType: 'assignment', groupId } }, upsert: true } })),
        ...exams.map(e => ({ updateOne: { filter: { userId: studentId, contentId: e._id }, update: { $set: { contentType: 'exam', groupId } }, upsert: true } })),
        ...materials.map(m => ({ updateOne: { filter: { userId: studentId, contentId: m._id }, update: { $set: { contentType: 'material', groupId } }, upsert: true } })),
        ...sections.map(s => ({ updateOne: { filter: { userId: studentId, contentId: s._id }, update: { $set: { contentType: 'section', groupId } }, upsert: true } })),
    ];

    // Build operations for SubmissionStatus
    const statusOps = [
        ...assignments.map(a => ({ updateOne: { filter: { studentId, contentId: a._id }, update: { $setOnInsert: { contentType: 'assignment', submissionModel: 'subassignment', groupId, status: 'assigned' } }, upsert: true } })),
        ...exams.map(e => ({ updateOne: { filter: { studentId, contentId: e._id }, update: { $setOnInsert: { contentType: 'exam', submissionModel: 'subexam', groupId, status: 'assigned' } }, upsert: true } })),
    ];
    
    // Execute all operations in bulk for maximum efficiency.
    if (streamOps.length > 0) await contentStreamModel.bulkWrite(streamOps, { session });
    if (statusOps.length > 0) await submissionStatusModel.bulkWrite(statusOps, { session });
};

// CORRECTED: This function now correctly revokes access when a student is removed.
const revokeContentFromStudent = async ({ studentId, groupId, session }) => {
    await Promise.all([
        contentStreamModel.deleteMany({ userId: studentId, groupId: groupId }, { session }),
        submissionStatusModel.deleteMany({ studentId: studentId, groupId: groupId }, { session }),
    ]);
};

// ... (archiveOrRestore remains the same) ...

// CORRECTED: The removeStudent function is now wrapped in a transaction and correctly calls revokeContentFromStudent.
export const removeStudent = asyncHandler(async(req,res,next)=>{
    const { groupid, studentid } = req.body;
    
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const group = await groupModel.findById(groupid).session(session);
        if (!group) throw new Error('Invalid Group ID', { cause: 400 });

        const student = await studentModel.findById(studentid).session(session);
        if (!student) throw new Error('Student not found', { cause: 404 });

        await revokeContentFromStudent({ studentId: studentid, groupId: groupid, session });

        // CHANGED: Use $pull to remove from the student's groupIds array
        student.groupIds.pull(groupid);
        group.enrolledStudents.pull(studentid);

        await student.save({ session });
        const updatedGroup = await group.save({ session });
        
        await session.commitTransaction();
        const populatedGroup = await updatedGroup.populate("enrolledStudents", "_id userName firstName");
        res.status(200).json({ Message: "Student removed successfully", updatedGroup: populatedGroup });

    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});

export const addStudentsToGroup = asyncHandler(async (req, res, next) => {
    const { groupid, studentIds } = req.body;

    if (!mongoose.Types.ObjectId.isValid(groupid)) {
        return res.status(400).json({ message: "Invalid Group ID format" });
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ message: "studentIds must be a non-empty array" });
    }
    const uniqueStudentIds = [...new Set(studentIds)];

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const [group, students] = await Promise.all([
            groupModel.findById(groupid).session(session),
            studentModel.find({ _id: { $in: uniqueStudentIds } }).session(session),
        ]);

        if (!group) throw new Error("Group not found", { cause: 404 });
        if (students.length !== uniqueStudentIds.length) {
            throw new Error("One or more students not found", { cause: 404 });
        }

        // Filter out students who are already in the group
        const studentsToAdd = students.filter(student => !student.groupIds.some(id => id.equals(group._id)));

        if (studentsToAdd.length > 0) {
            const studentIdsToAdd = studentsToAdd.map(s => s._id);

            // Modify documents in memory first
            studentsToAdd.forEach(student => student.groupIds.addToSet(group._id));
            studentIdsToAdd.forEach(id => group.enrolledStudents.addToSet(id));

            // Prepare all save operations
            const studentSavePromises = studentsToAdd.map(student => student.save({ session }));
            const groupSavePromise = group.save({ session });

            // Execute all saves concurrently
            await Promise.all([...studentSavePromises, groupSavePromise]);

            // Fan out content to all newly added students in parallel for better performance
            await Promise.all(studentsToAdd.map(student =>
                fanOutContentToStudent({ studentId: student._id, groupId: groupid, session })
            ));
        }

        await session.commitTransaction();
        
        const finalGroup = await groupModel.findById(groupid).populate("enrolledStudents", "_id userName firstName");
        res.status(200).json({ message: `${studentsToAdd.length} student(s) added successfully.`, group: finalGroup });

    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});



export const groupDelete = asyncHandler(async (req, res, next) => {
  const { groupid } = req.body;

  if (!mongoose.Types.ObjectId.isValid(groupid)) {
      return next(new Error('Invalid Group ID', { cause: 400 }));
  }
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const deletedGroup = await groupModel.findByIdAndDelete(groupid, { session });
        if (!deletedGroup) throw new Error('Group not found', { cause: 404 });

        // Unassign students
       await studentModel.updateMany(
            { groupIds: groupid }, // Find all students who were in this group.
            { $pull: { groupIds: groupid } }, // Remove the groupid from their array.
            { session }
        );
        await Promise.all([
            contentStreamModel.deleteMany({ groupId: groupid }, { session }),
            submissionStatusModel.deleteMany({ groupId: groupid }, { session })
        ]);
        
        await session.commitTransaction();
        res.status(200).json({ message: 'Group deleted successfully',deletedGroup});
    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});



export const createInviteLink = asyncHandler(async (req, res, next) => {
    const { groupid } = req.body;

    const group = await groupModel.findById(groupid);
    if (!group) {
        return next(new Error('Group not found', { cause: 404 }));
    }

    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 24 * 60 * 60 * 1000; // Link is valid for 24 hours

    group.inviteToken = token;
    group.inviteTokenExpires = new Date(expires);
    group.isInviteLinkActive = true;
    await group.save();

    const inviteLink = `${req.protocol}://${req.get('host')}/group/join/${token}`;

    res.status(200).json({ message: 'Invite link created successfully.', inviteLink });
});

export const deleteInviteLink = asyncHandler(async (req, res, next) => {
    const { groupid } = req.body;

    const group = await groupModel.findByIdAndUpdate(groupid, {
        $set: { isInviteLinkActive: false },
        $unset: { inviteToken: "", inviteTokenExpires: "" }
    }, { new: true });

    if (!group) {
        return next(new Error('Group not found', { cause: 404 }));
    }

    res.status(200).json({ message: 'Invite link has been disabled.' });
});

export const joinWithInviteLink = asyncHandler(async (req, res, next) => {
    const { inviteToken } = req.params;
    const studentId = req.user._id;

    if (req.isteacher) {
        return next(new Error('Only students can join with an invite link.', { cause: 403 }));
    }

    const group = await groupModel.findOne({
        inviteToken, isInviteLinkActive: true, inviteTokenExpires: { $gt: new Date() }
    });
    if (!group) return next(new Error('Invalid or expired invite link.', { cause: 400 }));

    const student = await studentModel.findById(studentId);
    if (!student) return next(new Error('Student profile not found.', { cause: 404 }));

    // CHANGED: Check if student is already a member of this specific group
    const isAlreadyMember = student.groupIds.some(id => id.equals(group._id));
    if (isAlreadyMember) {
        return res.status(200).json({ message: 'You are already a member of this group.' });
    }
    
    // Atomically add the student to the new group
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        student.groupIds.addToSet(group._id);
        group.enrolledStudents.addToSet(studentId);

        await fanOutContentToStudent({ studentId, groupId: group._id, session });
        
        await student.save({ session });
        await group.save({ session });

        await session.commitTransaction();
        res.status(200).json({ message: 'Successfully joined the group!', group: { name: group.groupname } });
    } catch (error) {
        await session.abortTransaction();
        return next(error);
    } finally {
        await session.endSession();
    }
});

export const getInviteLink = asyncHandler(async (req, res, next) => {
    const { groupid } = req.query;

    const group = await groupModel.findById(groupid).lean();

    if (!group) {
        return next(new Error('Group not found.', { cause: 404 }));
    }

    if (!group.isInviteLinkActive || !group.inviteToken || new Date() > group.inviteTokenExpires) {
        return res.status(200).json({ message: 'There is no active invite link for this group.' });
    }
    
    const inviteLink = `${req.protocol}://${req.get('host')}/api/v1/groups/join/${group.inviteToken}`;

    res.status(200).json({ 
        message: 'Active invite link retrieved.', 
        inviteLink,
        expiresAt: group.inviteTokenExpires.toISOString() 
    });
});


export const archiveOrRestore= asyncHandler(async(req,res,next)=>{
    const {_id,archivedOrRestore} =req.body;
    if (!mongoose.Types.ObjectId.isValid(_id)) {
            return next(new Error(`Invalid Group ID format`, { cause: 400 }));
        }
    const groupId = new mongoose.Types.ObjectId(_id);



    const group = await groupModel.findById(groupId);
    if(!group)return res.status(404).json ({Message : 'Group not found'});
    
    group.isArchived = archivedOrRestore;
    await group.save();
    res.status(201).json ({Message : 'Group Edited successfully'});
});