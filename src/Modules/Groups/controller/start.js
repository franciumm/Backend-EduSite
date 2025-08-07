import {gradeModel} from '../../../../DB/models/grades.model.js';
import {groupModel}from "../../../../DB/models/groups.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";


export const create = asyncHandler(async(req,res,next)=>{

    const {grade,groupname }= req.body;
    
    const {_id}= req.user;
    
   const isgroup =  await groupModel.findOne({groupname});
   if(isgroup ){ return next (new Error ('Invalid Data'));};
   const isgrade = await gradeModel.findOne({grade});
   if(!isgrade){ return next (new Error ('Invalid Data'));};
   
   
   const create =  await groupModel.create({gradeid :isgrade._id , groupname,createdBy : _id});
   
if(!create){
   
    return next(new Error ( ' Error Ocurred Creating the Group'),{cause : 400})
}
   res.status (201).json({Message:'Done' , create});
});


