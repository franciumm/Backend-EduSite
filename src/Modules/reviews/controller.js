import mongoose from "mongoose";
import {
  PendingReviewModel,
  PublishedReviewModel,
  UnpublishedReviewModel,
  reviewModels,
} from "../../../DB/models/reviews.model.js"; // Adjust path
import { asyncHandler } from "../../utils/erroHandling.js";
import { pagination } from "../../utils/pagination.js";

/**
 * @desc    Student creates a review, which goes into the 'pending' collection
 */
export const createReview = asyncHandler(async (req, res, next) => {
  if (req.isteacher) {
    return next(new Error("Only students can create a review.", { cause: 403 }));
  }

  const studentId = req.user._id;

  // To maintain uniqueness, we must check all three collections
  const existingReview = await Promise.all([
    PendingReviewModel.findOne({ createdBy: studentId }),
    PublishedReviewModel.findOne({ createdBy: studentId }),
    UnpublishedReviewModel.findOne({ createdBy: studentId }),
  ]);

  if (existingReview.some((review) => review)) {
    return next(new Error("You have already submitted a review.", { cause: 409 }));
  }

  const review = await PendingReviewModel.create({
    createdBy: studentId,
    rate: req.body.rate,
    description: req.body.description,
  });

  res.status(201).json({ message: "Your review has been submitted for approval.", review });
});

/**
 * @desc    Admin gets ALL reviews by fetching from all 3 collections
 */
export const getAllReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  // Fetch from all collections in parallel
  const [pending, published, unpublished] = await Promise.all([
    PendingReviewModel.find({}).populate("createdBy", "userName email").lean(),
    PublishedReviewModel.find({}).populate("createdBy", "userName email").lean(),
    UnpublishedReviewModel.find({}).populate("createdBy", "userName email").lean(),
  ]);

  // Add a status to each review so the frontend knows where it came from
  const allReviews = [
    ...pending.map(r => ({ ...r, status: 'pending' })),
    ...published.map(r => ({ ...r, status: 'published' })),
    ...unpublished.map(r => ({ ...r, status: 'unpublished' })),
  ];

  // Manually sort and paginate the merged results in application code
  allReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const paginatedReviews = allReviews.slice(skip, skip + limit);

  res.status(200).json({ message: "All reviews fetched", data: paginatedReviews });
});

/**
 * @desc    Public endpoint to get reviews ONLY from the 'published' collection
 */
export const getPublishedReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  const reviews = await PublishedReviewModel.find({})
    .populate("createdBy", "userName firstName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({ message: "Published reviews fetched", data: reviews });
});

/**
 * @desc    Admin moves a review from one collection to another
 */
export const updateReviewStatus = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;
  const { currentStatus, targetStatus } = req.body;

  if (!reviewModels[currentStatus] || !reviewModels[targetStatus]) {
    return next(new Error("Invalid status provided.", { cause: 400 }));
  }
  if (currentStatus === targetStatus) {
    return next(new Error("Review is already in the target status.", { cause: 400 }));
  }

  const SourceModel = reviewModels[currentStatus];
  const TargetModel = reviewModels[targetStatus];

  // Use a transaction to ensure data integrity
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const originalReview = await SourceModel.findById(reviewId).session(session);
    if (!originalReview) {
      throw new Error("Review not found in the source collection.", { cause: 404 });
    }

    // Create the new review in the target collection
    const [newReview] = await TargetModel.create([originalReview.toObject()], { session });

    // Delete the original review from the source collection
    await SourceModel.findByIdAndDelete(reviewId).session(session);

    await session.commitTransaction();
    res.status(200).json({ message: `Review successfully moved to '${targetStatus}'.`, review: newReview });

  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});

/**
 * @desc    Admin deletes a review from ANY of the collections
 */
export const deleteReview = asyncHandler(async (req, res, next) => {
    const { reviewId } = req.params;
    let deletedReview = null;

    // Try to find and delete the review from each collection
    for (const model of Object.values(reviewModels)) {
        deletedReview = await model.findByIdAndDelete(reviewId);
        if (deletedReview) break;
    }

    if (!deletedReview) {
        return next(new Error("Review not found in any collection.", { cause: 404 }));
    }

    res.status(200).json({ message: "Review deleted successfully." });
});