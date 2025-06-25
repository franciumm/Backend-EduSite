import { Schema, model } from "mongoose";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js";
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



submittedExamSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    if (this.fileKey) {
        // This will now automatically clean up the S3 file when a submission is deleted.
        await deleteFileFromS3(this.fileBucket, this.fileKey);
    }
    next();
});



submittedExamSchema.index({ studentId: 1, examId: 1, version: -1 });

export const SubexamModel = model("subexam", submittedExamSchema);