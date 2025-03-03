import { Schema, model } from "mongoose";

const submittedExamSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: "exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "student", required: true },
    score: { type: Number, default: null },  // teacher's mark
    notes: { type: String },                 // student's notes

    // PDF info for submission
    fileBucket: String,
    fileKey: String,
    filePath: String,

    // teacher’s optional feedback text
    teacherFeedback: { type: String, default: "" },
  },
  { timestamps: true }
);

export const SubexamModel = model("subexam", submittedExamSchema);