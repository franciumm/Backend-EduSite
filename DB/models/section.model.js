// DB/models/section.model.js

import { Schema, model } from "mongoose";

const sectionSchema = new Schema(
  {
    name: { 
      type: String, 
      required: true,
      trim: true ,
       unique : true
    },
    description: { 
      type: String,
      trim: true
    },
    groupIds: [{ 
      type: Schema.Types.ObjectId, 
      ref: "group", 
      required: true 
    }],
    
    // --- Linked Content ---
    linkedAssignments: [{ 
      type: Schema.Types.ObjectId, 
      ref: "assignment" 
    }],
    linkedExams: [{ 
      type: Schema.Types.ObjectId, 
      ref: "exam" 
    }],
    linkedMaterials: [{ 
      type: Schema.Types.ObjectId, 
      ref: "material" 
    }],
    // --- FINAL REFINEMENT: 'linkedSections' has been removed as per your directive. ---
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "teacher",
      required: true,
    },
  },
  { timestamps: true }
);

sectionSchema.index({ name: 1 }, { unique: true });
sectionSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
  try {
    // IMPORTANT: Use mongoose.model() to avoid circular dependency errors.
    const assignmentModel = mongoose.model('assignment');
    const examModel = mongoose.model('exam');
    const materialModel = mongoose.model('material');
    const contentStreamModel = mongoose.model('contentStream');

    // Get the session from the current operation, if it exists.
    // This allows the hook to participate in the transaction started in the controller.
    const session = this.$session();

    // Fetch all linked documents that need to be deleted.
    const [assignmentsToDelete, examsToDelete, materialsToDelete] = await Promise.all([
        assignmentModel.find({ '_id': { $in: this.linkedAssignments } }).session(session),
        examModel.find({ '_id': { $in: this.linkedExams } }).session(session),
        materialModel.find({ '_id': { $in: this.linkedMaterials } }).session(session)
    ]);

    // Create an array of deletion promises.
    // Calling .deleteOne() on each document instance triggers THEIR S3 cleanup hooks.
    const deletionPromises = [
        ...assignmentsToDelete.map(doc => doc.deleteOne({ session })),
        ...examsToDelete.map(doc => doc.deleteOne({ session })),
        ...materialsToDelete.map(doc => doc.deleteOne({ session }))
    ];

    // Also, delete the content stream entry for the section itself.
    deletionPromises.push(
        contentStreamModel.deleteMany({ contentId: this._id, contentType: 'section' }, { session })
    );

    // Execute all deletions in parallel.
    await Promise.all(deletionPromises);

    next();
  } catch (error) {
    // If anything fails, pass the error to the next middleware (which will abort the transaction)
    console.error("Error during section cascade delete:", error);
    next(error);
  }
});
export const sectionModel = model("section", sectionSchema);