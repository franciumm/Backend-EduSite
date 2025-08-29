import {Schema, model} from "mongoose";


const groupsSchema = Schema(
    {
        
        groupname : {type : String,  required :[true ,'Gourp name must be typed'] ,unique : [true ,'group must be unique']},
        isArchived : {type : Boolean , default : false },
        enrolledStudents:[{type: Schema.Types.ObjectId, ref:'student' }] ,
      inviteToken: {
            type: String,
            unique: true,
            sparse: true 
        },
        inviteTokenExpires: {
            type: Date
        },
        isInviteLinkActive: {
            type: Boolean,
            default: false
        }
    }, 
    { timestamps: true }
);

export const groupModel = model('group', groupsSchema);