import {Schema, model} from "mongoose";
const gradeSchema = new Schema(
    {
      grade: {
        type: Number,
        required: true,
        enum: [7, 8, 9, 10, 11, 12],
      },
      enrolledStudents: [{ type: Schema.Types.ObjectId, ref: 'student' }],
    },
    { timestamps: true }
  );
  
  export const gradeModel = model('grade', gradeSchema);