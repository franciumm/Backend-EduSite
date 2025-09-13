// /DB/models/exams.model.js

import { Schema, model } from "mongoose";
import { SubexamModel } from "./submitted_exams.model.js";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js"; // Verify this path is correct
import { sectionModel } from "./section.model.js";
const examSchema = new Schema(
  {
    Name: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "teacher", required: true },
    groupIds: [{ type: Schema.Types.ObjectId, ref: "group" }], // Multiple groups
    bucketName: String,
    key: String,
    path: String,  
     answerBucketName: String, // ADDED
    answerKey: String, // ADDED
    answerPath: String, // ADDED

    allowSubmissionsAfterDueDate: {
        type: Boolean,
        default: false, // By default, submissions are closed after the due date.
    },
    startdate: { type: Date, required: true },
    enddate: { type: Date, required: true },
    enrolledStudents: [{ type: Schema.Types.ObjectId, ref: "student" }],
    rejectedStudents: [{ type: Schema.Types.ObjectId, ref: "student" }], // For exceptions you do NOT want
    
    exceptionStudents: [
      {
        studentId: { type: Schema.Types.ObjectId, ref: "student" },
        startdate: Date,
        enddate: Date,
      },
    ],
  },
  { timestamps: true }
);
examSchema.index({ groupIds: 1 });

examSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    const submissions = await SubexamModel.find({ examId: this._id });

    if (submissions.length > 0) {
        // This part deletes submission files. It looks correct.
        const s3FilesToDelete = submissions
            .filter(sub => sub.fileKey && sub.fileBucket)
            .map(sub => deleteFileFromS3(sub.fileBucket, sub.fileKey));
        await Promise.all(s3FilesToDelete);
        await SubexamModel.deleteMany({ examId: this._id });
    }
    


    // This part deletes the main exam file.
    if (this.key && this.bucketName) {
        await deleteFileFromS3(this.bucketName, this.key);
    }
      if (this.answerKey && this.answerBucketName) {
        await deleteFileFromS3(this.answerBucketName, this.answerKey);
    }
     await sectionModel.updateMany(
            { linkedExams: this._id },
            { $pull: { linkedExams: this._id } },
            { session: this.$session() }

        );
    next();
});

export const examModel = model("exam", examSchema);
