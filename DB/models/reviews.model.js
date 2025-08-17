import { Schema, model } from "mongoose";

const reviewSchema = new Schema(
  {
    // The student who wrote the review. This is the only link we need.
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "student", // Reference the student model
      required: true,
      unique: true, // A student can only create one review
    },
    // The rating from 1 to 5
    rate: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    // The text content of the review
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // The flag that the main teacher will control
    isPublished: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const reviewModel = model("review", reviewSchema);