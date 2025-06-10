import {gradeModel} from '../../../../DB/models/grades.model.js';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";

export const getall = asyncHandler(async(req,res,next)=>{
    const groups = await groupModel.find().populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    res.status(201).json({Message : "Done", groups});
}); 
export const Bygrade = asyncHandler(async (req, res, next) => {
  const { grade } = req.query; // e.g. “10”

  const gradeDoc = await gradeModel.findOne({ grade: grade });
  if (!gradeDoc) {
    return next(new Error(`Grade "${grade}" not found`, { cause: 404 }));
  }

  // 2️⃣ Fetch groups and populate students with their submission details
  const groups = await groupModel
    .find({ gradeid: gradeDoc._id })
    .populate({
      path: "enrolledStudents",
      // Select all the fields you want from the student document
      select: "_id userName firstName lastName phone email parentPhone submittedassignments submittedexams",
      // Now, populate the fields *within* the student documents
      populate: [
        {
          path: "submittedassignments", // This path must exist in the student schema
          select: "assignmentId -_id"   // Select ONLY the assignmentId, exclude the submission's _id
        },
        {
          path: "submittedexams",       // This path must also exist
          select: "examId -_id"         // Select ONLY the examId, exclude the submission's _id
        }
      ]
    });

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
