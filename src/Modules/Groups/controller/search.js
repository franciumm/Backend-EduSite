import {gradeModel} from '../../../../DB/models/grades.model.js';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";

export const getall = asyncHandler(async(req,res,next)=>{
    const groups = await groupModel.find().populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    res.status(201).json({Message : "Done", groups});
}); 

export const Bygrade  = asyncHandler(async (req, res, next) => {
  const { grade } = req.query;
  
  const gradeDoc = await gradeModel.findOne({ grade: grade });
  if (!gradeDoc) {
    return next(new Error(`Grade "${grade}" not found`, { cause: 404 }));
  }

  // This query now works because the schema references are correct.
  const groups = await groupModel
    .find({ gradeid: gradeDoc._id })
    .populate({
      path: "enrolledStudents",
      select: "_id userName firstName lastName submittedassignments submittedexams",
      populate: [
        {
          path: "submittedassignments", // Now correctly populates 'subassignment' docs
          select: "assignmentId"        // Selects the 'assignmentId' field from them
        },
        {
          path: "submittedexams",       // Now correctly populates 'subexam' docs
          select: "examId"              // Selects the 'examId' field from them
        }
      ]
    });

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
