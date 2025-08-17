import { Schema, model } from "mongoose";

const reviewSchema = new Schema(
  {
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "student",
      required: true,
      unique: true, // Guarantees a student can only submit one review
    },
    rate: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'published', 'unpublished'], // Enforces data integrity
      default: 'pending', // New reviews are always pending
      index: true, // Creates a high-performance index for status-based queries
    },
  },
  { timestamps: true }
);

// Compound index for the public-facing query to make it extremely fast
reviewSchema.index({ status: 1, createdAt: -1 });

export const reviewModel = model("review", reviewSchema);