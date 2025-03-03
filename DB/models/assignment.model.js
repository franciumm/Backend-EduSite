import {Schema, model} from "mongoose";

const assignmentSchema = new Schema({
    name: { type: String, required: true },
    startDate: Date,
    endDate: Date,
    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'group',
    },
    gradeId: {
      type: Schema.Types.ObjectId,
      ref: 'grade',
    },
    bucketName: String,
    key: String,
    fileContent: String,
    path: String,
    enrolledStudents: [{ type: Schema.Types.ObjectId, ref: 'student' }],
    rejectedStudents: [{ type: Schema.Types.ObjectId, ref: "student" }], 
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'teacher',
        required: true,
      }
  }, { timestamps: true });
  
export const assignmentModel = model('assignment', assignmentSchema);