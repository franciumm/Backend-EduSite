import {gradeModel} from '../../../../DB/models/grades.model.js';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";

export const getall = asyncHandler(async(req,res,next)=>{
    const groups = await groupModel.find().populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    res.status(201).json({Message : "Done", groups});
}); 


// controllers/group.controller.js

export const Bygrade  = asyncHandler(async (req, res, next) => {
  const { grade } = req.query;                            // e.g. “10”
  
  const gradeDoc = await gradeModel.findOne({ grade: grade });
  if (!gradeDoc) {
    return next(new Error(`Grade "${grade}" not found`, { cause: 404 }));
  }

  // 2️⃣ Fetch groups for that grade, populate students
  const groups = await groupModel
    .find({ gradeid: gradeDoc._id })
    .populate("enrolledStudents", "_id userName firstName lastName phone email parentPhone submittedassignments submittedexams ");

  // 3️⃣ Return
  res.status(200).json({
    Message: "Groups fetched successfully",
    groups
  });
});

export const ById = asyncHandler(async(req,res,next)=>{
    const {_id}= req.query ; 

    const groups = await groupModel.findById(_id).populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    
    res.status(201).json({Message : "Done", groups});
}); 
