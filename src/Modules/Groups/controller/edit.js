import {gradeModel} from '../../../../DB/models/grades.model.js';

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
