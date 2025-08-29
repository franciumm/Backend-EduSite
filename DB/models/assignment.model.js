import {Schema, model} from "mongoose";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js";
import { SubassignmentModel } from "./submitted_assignment.model.js";
import { sectionModel } from "./section.model.js";

const assignmentSchema = new Schema({
    name: { type: String, required: true },
    startDate: Date,
    teacherNotes: { type: String },
    endDate: Date,
    groupIds: [{ type: Schema.Types.ObjectId, ref: "group" }],
    answerBucketName: String, 
    answerKey: String, 
    answerPath: String, 
    bucketName: String,
    key: String,
    fileContent: String,
    path: String,
   
     allowSubmissionsAfterDueDate: {
        type: Boolean,
        default: false,
    },
    enrolledStudents: [{ type: Schema.Types.ObjectId, ref: 'student' }],
    rejectedStudents: [{ type: Schema.Types.ObjectId, ref: "student" }], 
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'teacher',
        required: true,
      }
  }, { timestamps: true });


  
assignmentSchema.index({ gradeId: 1, groupIds: 1 });


  assignmentSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    // Delete the main assignment file
    if (this.key && this.bucketName) {
        await deleteFileFromS3(this.bucketName, this.key);
    }
  if (this.answerKey && this.answerBucketName) {
        await deleteFileFromS3(this.answerBucketName, this.answerKey);
    }

    // Find all child submissions
    const submissions = await SubassignmentModel.find({ assignmentId: this._id });
    if (submissions.length > 0) {
        // Delete all their S3 files in parallel
        const s3Deletions = submissions
            .filter(sub => sub.key && sub.bucketName)
            .map(sub => deleteFileFromS3(sub.bucketName, sub.key));
        await Promise.all(s3Deletions);

        // Delete all the submission database records
        await SubassignmentModel.deleteMany({ assignmentId: this._id });
    }

      await sectionModel.updateMany(
        { linkedAssignments: this._id },
        { $pull: { linkedAssignments: this._id } }
    );
    next();
});


export const assignmentModel = model('assignment', assignmentSchema);