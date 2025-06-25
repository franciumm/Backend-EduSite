import { Schema, model } from "mongoose";

const submittedExamSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: "exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "student", required: true },
    score: { type: Number, default: null },
    notes: { type: String },
    examname :  { type: String, required: true },

    // Add a version number to track attempts
    version: { type: Number, required: true },

    // PDF info for submission
    fileBucket: String,
    fileKey: String,
    filePath: String,
    SubmitDate: Date,
    isLate: {
      type: Boolean,
      default: false,
    },
    teacherFeedback: { type: String, default: "" },
  },
  { timestamps: true }
);

// We remove the unique index and add a new one for performance
submittedExamSchema.index({ studentId: 1, examId: 1, version: -1 });

export const SubexamModel = model("subexam", submittedExamSchema);