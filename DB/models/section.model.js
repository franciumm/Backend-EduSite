// DB/models/section.model.js

import { Schema, model } from "mongoose";

const sectionSchema = new Schema(
  {
    name: { 
      type: String, 
      required: true,
      trim: true 
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
    gradeId: { 
      type: Schema.Types.ObjectId, 
      ref: "grade", 
      required: true 
    },
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

sectionSchema.index({ name: 1, gradeId: 1 }, { unique: true });

export const sectionModel = model("section", sectionSchema);