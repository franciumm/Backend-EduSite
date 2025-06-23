import { Schema, model } from "mongoose";

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
    isLate: Boolean, // Indicates if the submission was late
    isMarked :{type:Boolean,  default: false},
      isLate: {
      type: Boolean,
      default: false,
    },
    SubmitDate: Date,
assignmentname:  { type: String, required: true },
  },
  { timestamps: true }
);
submittedAssignmentSchema.index({ studentId: 1, assignmentId: 1 }, { unique: true }); // A compound unique index is even better!

export const SubassignmentModel = model("subassignment", submittedAssignmentSchema);
