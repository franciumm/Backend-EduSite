import {gradeModel} from '../../../../DB/models/grades.model.js';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";

export const getall = asyncHandler(async(req,res,next)=>{
    const groups = await groupModel.find().populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    res.status(201).json({Message : "Done", groups});
}); 



export const Bygrade = asyncHandler(async(req,res,next)=>{
    const {gradeid}= req.query ; 

    const groups = await groupModel.find({gradeid}).populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    res.status(201).json({Message : "Done", groups});
}); 



export const ById = asyncHandler(async(req,res,next)=>{
    const {_id}= req.query ; 

    const groups = await groupModel.findById(_id).populate("enrolledStudents", {_id :1 , userName:1,firstName :1});
    
    res.status(201).json({Message : "Done", groups});
}); 
