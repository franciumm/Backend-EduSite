import { Schema, model } from "mongoose";


const materialSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    groupIds: [{ type: Schema.Types.ObjectId, ref: "group", required: true }],
    gradeId: { type: Schema.Types.ObjectId, ref: "grade" },
    bucketName: { type: String, required: true },
    key: { type: String, required: true },
    path: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "teacher",
      required: true,
    },   
     status: {
      type: String,
      enum: ["Pending Upload", "Uploaded", "Failed"],
      default: "Uploaded"
   },
  },
  { timestamps: true }
);


const materialModel = model("material", materialSchema);
export default materialModel;