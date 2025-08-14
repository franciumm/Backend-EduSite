import {gradeModel} from '../../../../DB/models/grades.model.js';
import crypto from 'crypto'; 
import {groupModel}from "../../../../DB/models/groups.model.js";
import studentModel from '../../../../DB/models/student.model.js';
import { asyncHandler } from "../../../utils/erroHandling.js";
import mongoose from 'mongoose';




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



export const addStudent = asyncHandler(async (req, res, next) => {
  const { groupid, studentid } = req.body;

 
  if ( !mongoose.Types.ObjectId.isValid(groupid) ||!mongoose.Types.ObjectId.isValid(studentid) ) {
    return res.status(400).json({ message: 'Invalid Group ID or Student ID' });
  }

  
  const student = await studentModel.findById(studentid);
  if (!student) {
    return res.status(404).json({ message: 'Student not found' });
  }


const group = await groupModel.findById(groupid);

if(student.gradeId.toString() != group.gradeid.toString()){
  return res.status(404).json({ message: 'Student not In the groups Grade' });
}
  student.groupId = groupid;
  await student.save();
  const updatedGroup = await groupModel.findByIdAndUpdate(
    groupid,
    { $addToSet: { enrolledStudents: studentid } },
    { new: true, runValidators: true }
  ).populate("enrolledStudents", {_id :1 , userName:1,firstName :1});

  if (!updatedGroup) {
    return res.status(404).json({ message: 'Group not found' });
  }

  res.status(200).json({
    message: 'Student added successfully',
    updatedGroup
  });
});


export const groupDelete = asyncHandler(async (req, res, next) => {
  const { groupid } = req.body;

  if (!mongoose.Types.ObjectId.isValid(groupid)) {
      return next(new Error('Invalid Group ID', { cause: 400 }));
  }

  const deletedGroup = await groupModel.findByIdAndDelete(groupid);

  if (!deletedGroup) {
      return next(new Error('Group not found', { cause: 404 }));
  }

  await studentModel.updateMany(
      { groupid: groupid },
      { $unset: { groupid: "" } }
  );

  res.status(200).json({ message: 'Group deleted successfully', deletedGroup });
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

    const inviteLink = `${req.protocol}://${req.get('host')}/api/v1/groups/join/${token}`;

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

    if (student.groupId && student.groupId.equals(group._id)) {
        return res.status(200).json({ message: 'You are already a member of this group.' });
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