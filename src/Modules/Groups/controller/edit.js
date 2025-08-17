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




export const addStudentsToGroup = asyncHandler(async (req, res, next) => {
  const { groupid, studentIds } = req.body;

  // 1. --- Input Validation ---
  if (!mongoose.Types.ObjectId.isValid(groupid)) {
    return res.status(400).json({ message: "Invalid Group ID format" });
  }
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res
      .status(400)
      .json({ message: "studentIds must be a non-empty array" });
  }
  for (const studentId of studentIds) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res
        .status(400)
        .json({ message: `Invalid Student ID format: ${studentId}` });
    }
  }

  // 2. --- Data Fetching ---
  // Find the group and students concurrently for better performance
  const [group, students] = await Promise.all([
    groupModel.findById(groupid),
    studentModel.find({ _id: { $in: studentIds } }),
  ]);

  if (!group) {
    return res.status(404).json({ message: "Group not found" });
  }
  if (students.length !== studentIds.length) {
    return res
      .status(404)
      .json({ message: "One or more students not found" });
  }

  // 3. --- Business Logic Validation ---
  // Ensure every student is in the correct grade
  for (const student of students) {
    if (student.gradeId.toString() !== group.gradeid.toString()) {
      return res.status(400).json({
        message: `Student '${student.userName}' is not in the same grade as the group.`,
      });
    }
  }

  // 4. --- Database Updates (Bulk Operations) ---
  // Update all students to set their new groupId
  await studentModel.updateMany(
    { _id: { $in: studentIds } },
    { $set: { groupId: groupid } }
  );

  // Add all new students to the group's enrolledStudents array
  const updatedGroup = await groupModel
    .findByIdAndUpdate(
      groupid,
      { $addToSet: { enrolledStudents: { $each: studentIds } } },
      { new: true, runValidators: true }
    )
    .populate("enrolledStudents", "_id userName firstName"); // Populate with selected fields

  // 5. --- Response ---
  res.status(200).json({
    message:'Student added successfully',
    group: updatedGroup,
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