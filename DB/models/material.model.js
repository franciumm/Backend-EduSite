import { Schema, model } from "mongoose";

const materialSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    groupIds: [{ type: Schema.Types.ObjectId, ref: "group", required: true }],
    gradeId: { type: Schema.Types.ObjectId, ref: "grade" },
    bucketName: { type: String, required: true },
    linksArray :  [{ 
      type: String
    } ],
    files: [
      {
        key: { type: String, required: true },
        path: { type: String, required: true },
        originalName: { type: String, required: true },
        fileType: { type: String },
        _id: false // It's good practice to disable subdocument IDs if not needed
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "teacher",
      required: true,
    },
    // The old fields like 'MaterialLinks' and 'status' are no longer needed
  },
  { timestamps: true }
);

const materialModel = model("material", materialSchema);
export default materialModel;