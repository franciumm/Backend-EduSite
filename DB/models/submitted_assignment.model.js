import { Schema, model } from "mongoose";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js";

const submittedAssignmentSchema = new Schema(
  {
    score: Number,
    studentId: { type: Schema.Types.ObjectId, ref: "student",required : true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "assignment",required : true },
    groupId: { type: Schema.Types.ObjectId, ref: "group",required : true },
    bucketName: String, // New Field for S3 bucket
    key: String, // New Field for S3 file key
    path: String, // New Field for S3 file path (public or signed URL)
    notes: String, // Notes about submission (e.g., "Late submission")
    isMarked :{type:Boolean,  default: false},
       
    version: { type: Number, required: true },
  isLate: {
      type: Boolean,
      default: false,
    },
     annotationData : {
    type : String ,
     default : null,
     select : false
  },
    SubmitDate: Date,
assignmentname:  { type: String, required: true },
  },
 
  { timestamps: true }
);




submittedAssignmentSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    if (this.key && this.bucketName) {
        await deleteFileFromS3(this.bucketName, this.key);
    }
    next();
});
export const SubassignmentModel = model("subassignment", submittedAssignmentSchema);
