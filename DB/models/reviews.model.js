import { Schema, model } from "mongoose";

// A single, reusable schema for all review types
const baseReviewSchema = new Schema(
  {
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "student",
      required: true,
      unique: true, // Note: This unique constraint is now only per-collection
    },
    rate: { type: Number, required: true, min: 1, max: 5 },
    description: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// Create three distinct models from the same schema
export const PendingReviewModel = model("PendingReview", baseReviewSchema);
export const PublishedReviewModel = model("PublishedReview", baseReviewSchema);
export const UnpublishedReviewModel = model("UnpublishedReview", baseReviewSchema);

// Helper object to easily access models by name
export const reviewModels = {
  pending: PendingReviewModel,
  published: PublishedReviewModel,
  unpublished: UnpublishedReviewModel,
};