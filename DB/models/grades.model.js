import {Schema, model} from "mongoose";
const gradeSchema = new Schema(
    {
      grade: {
        type: Number,
        required: true,
        unique : true
      },
      enrolledStudents: [{ type: Schema.Types.ObjectId, ref: 'student' }],
    },
    { timestamps: true }
  );
  
  export const gradeModel = model('grade', gradeSchema);