import { Schema, model } from "mongoose";


const materialSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "group",
      required: true,
    },
    bucketName: { type: String, required: true },
    key: { type: String, required: true },
    path: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "teacher",
      required: true,
    },
  },
  { timestamps: true }
);


const materialModel = model("material", materialSchema);
export default materialModel;