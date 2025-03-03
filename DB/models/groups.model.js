import {Schema, model} from "mongoose";


const groupsSchema = Schema(
    {
        gradeid :{
            type: Schema.Types.ObjectId,
            ref: 'grade',
            required: [true, 'GradeId is required'],
          },
        groupname : {type : String,  required :[true ,'Gourp name must be typed'] ,unique : [true ,'group must be unique']},
        enrolledStudents:[{type: Schema.Types.ObjectId, ref:'student' }] 
    },
    { timestamps: true }
);

export const groupModel = model('group', groupsSchema);