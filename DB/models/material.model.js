import { Schema, model } from "mongoose";
import { deleteFileFromS3 } from "../../src/utils/S3Client.js"; 

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
materialSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  

    // Check if there are any files to delete
    if (this.files && this.files.length > 0) {
        // Create an array of deletion promises for all files in the section
        const s3Deletions = this.files.map(file =>
            deleteFileFromS3(this.bucketName, file.key)
                .catch(err => console.error(`Failed to delete material file ${file.key} from S3, but continuing...`, err))
        );

        // Execute all deletion promises in parallel for maximum efficiency
        await Promise.all(s3Deletions);
        console.log(`S3 cleanup finished for material: ${this.name}`);
    }
await sectionModel.updateMany(
        { linkedMaterials: this._id },
        { $pull: { linkedMaterials: this._id } }
    );
    // Proceed to delete the document from the database
    next();
});

const materialModel = model("material", materialSchema);
export default materialModel;