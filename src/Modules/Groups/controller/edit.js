import {gradeModel} from '../../../../DB/models/grades.model.js';
import crypto from 'crypto'; 
import {groupModel}from "../../../../DB/models/groups.model.js";
import studentModel from '../../../../DB/models/student.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";
import mongoose from 'mongoose';
import { contentStreamModel } from '../../../../DB/models/contentStream.model.js';
import { submissionStatusModel } from '../../../../DB/models/submissionStatus.model.js';

const fanOutContentToStudent = async ({ studentId, groupId, session }) => {
    // 1. Find all content currently assigned to this group
    const [assignments, exams, materials, sections] = await Promise.all([
        assignmentModel.find({ groupIds: groupId }).select('_id gradeId').session(session),
        examModel.find({ groupIds: groupId }).select('_id grade').session(session),
        materialModel.find({ groupIds: groupId }).select('_id gradeId').session(session),
        sectionModel.find({ groupIds: groupId }).select('_id gradeId').session(session),
    ]);

    // 2. Prepare ContentStream entries for all found content
    const streamEntries = [
        ...assignments.map(a => ({ userId: studentId, contentId: a._id, contentType: 'assignment', gradeId: a.gradeId, groupId })),
        ...exams.map(e => ({ userId: studentId, contentId: e._id, contentType: 'exam', gradeId: e.grade, groupId })),
        ...materials.map(m => ({ userId: studentId, contentId: m._id, contentType: 'material', gradeId: m.gradeId, groupId })),
        ...sections.map(s => ({ userId: studentId, contentId: s._id, contentType: 'section', gradeId: s.gradeId, groupId })),
    ];
    
    // 3. Prepare SubmissionStatus entries for assignments and exams
    const statusEntries = [
        ...assignments.map(a => ({ studentId, contentId: a._id, contentType: 'assignment', submissionModel: 'subassignment', groupId, status: 'assigned' })),
        ...exams.map(e => ({ studentId, contentId: e._id, contentType: 'exam', submissionModel: 'subexam', groupId, status: 'assigned' })),
    ];
    
    // 4. Insert all new records
    if (streamEntries.length > 0) await contentStreamModel.insertMany(streamEntries, { session });
    if (statusEntries.length > 0) await submissionStatusModel.insertMany(statusEntries, { session });
};

const revokeContentFromStudent = async ({ studentId, groupId, session }) => {
    // Simply delete all stream and status entries linked to this user AND this specific group.
    // This is safe because a student can only be in one group at a time.
    await Promise.all([
        contentStreamModel.deleteMany({ userId: studentId, groupId: groupId }, { session }),
        submissionStatusModel.deleteMany({ studentId: studentId, groupId: groupId }, { session }),
    ]);
};



export const removeStudent = asyncHandler(async(req,res,next)=>{
    const {groupid , studentid }=req.body;
    const group = await groupModel.findById(groupid).populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    if (!group) {
        return next(new Error ( ' Invalid Group ID'),{cause : 400});
      }
      group.enrolledStudents.pull(studentid);
      const student = await studentModel.findById(studentid);
      student.groupId=null;
      await student.save();
      const updatedGroup = await group.save();
      res.status(201).json({Message : "Done" ,updatedGroup });

})



export const addStudentsToGroup = asyncHandler(async (req, res, next) => {
    const { groupid, studentIds } = req.body;

    // 1. --- Input Validation (from original) ---
    if (!mongoose.Types.ObjectId.isValid(groupid)) {
        return res.status(400).json({ message: "Invalid Group ID format" });
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ message: "studentIds must be a non-empty array" });
    }
    const uniqueStudentIds = [...new Set(studentIds)]; // Ensure no duplicate student IDs are processed
    for (const studentId of uniqueStudentIds) {
        if (!mongoose.Types.ObjectId.isValid(studentId)) {
            return res.status(400).json({ message: `Invalid Student ID format: ${studentId}` });
        }
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        // 2. --- Data Fetching & Validation (from original, but inside the transaction) ---
        const [group, students] = await Promise.all([
            groupModel.findById(groupid).session(session),
            studentModel.find({ _id: { $in: uniqueStudentIds } }).session(session),
        ]);

        if (!group) {
            throw new Error("Group not found", { cause: 404 });
        }
        if (students.length !== uniqueStudentIds.length) {
            throw new Error("One or more students not found", { cause: 404 });
        }

        // 3. --- Business Logic Validation (from original) ---
        for (const student of students) {
            if (student.gradeId.toString() !== group.gradeid.toString()) {
                throw new Error(`Student '${student.userName}' is not in the same grade as the group.`, { cause: 400 });
            }
             if (student.groupId) {
                throw new Error(`Student '${student.userName}' is already in another group.`, { cause: 409 });
            }
        }

        // 4. --- Database Updates (Bulk Operations, from refactor) ---
        await studentModel.updateMany({ _id: { $in: uniqueStudentIds } }, { $set: { groupId: groupid } }, { session });
        const updatedGroup = await groupModel.findByIdAndUpdate(groupid, { $addToSet: { enrolledStudents: { $each: uniqueStudentIds } } }, { new: true, session }).populate("enrolledStudents", "_id userName firstName");

        // 5. --- NEW STEP: Fan out content to all newly added students (from refactor) ---
        for (const studentId of uniqueStudentIds) {
            await fanOutContentToStudent({ studentId, groupId: groupid, session });
        }

        await session.commitTransaction();
        res.status(200).json({ message: 'Students added successfully', group: updatedGroup });

    } catch (error) {
        await session.abortTransaction();
        // Forward the error with its original cause (400, 404, 409) to the global error handler
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
        await studentModel.updateMany({ groupId: groupid }, { $unset: { groupId: "" } }, { session });

        // *** NEW STEP: Clean up all stream/status entries for this group ***
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
        inviteToken,
        isInviteLinkActive: true,
        inviteTokenExpires: { $gt: new Date() }
    });

    if (!group) {
        return next(new Error('Invalid or expired invite link.', { cause: 400 }));
    }

    const student = await studentModel.findById(studentId);
    if (!student) {
        return next(new Error('Student profile not found.', { cause: 404 }));
    }

    if (student.gradeId.toString() !== group.gradeid.toString()) {
        return next(new Error('You cannot join a group for a different grade level.', { cause: 403 }));
    }
if (student.groupId) {
    if (student.groupId.equals(group._id)) {
        return res.status(200).json({ message: 'You are already a member of this group.' });
    }
    return next(new Error('You are already a member of another group. Please leave your current group to join a new one.', { cause: 400 }));
}
    
    // Atomically add the student to the new group and update the student's record
    student.groupId = group._id;
    await student.save();
    await groupModel.findByIdAndUpdate(group._id, { $addToSet: { enrolledStudents: studentId } });
    
    res.status(200).json({ message: 'Successfully joined the group!', group: { name: group.groupname } });
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