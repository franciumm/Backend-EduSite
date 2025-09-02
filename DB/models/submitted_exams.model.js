import { Schema, model } from "mongoose";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js";
import { sectionModel } from "./section.model.js";
const submittedExamSchema = new Schema(
  {
    examId: { type: Schema.Types.ObjectId, ref: "exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "student", required: true },
    score: { type: Number, default: null },
    notes: { type: String },
    examname :  { type: String, required: true },
groupId: { type: Schema.Types.ObjectId, ref: "group", required: true },
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
    annotationData : {
    type : String ,
     default : null
  },
    teacherFeedback: { type: String, default: "" },
  },
  { timestamps: true }
);


submittedExamSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    if (this.fileKey && this.fileBucket) { // Added fileBucket check for safety
        await deleteFileFromS3(this.fileBucket, this.fileKey);
    }
    next();
});


submittedExamSchema.index({ examId: 1, studentId: 1, groupId: 1 });
export const SubexamModel = model("subexam", submittedExamSchema);