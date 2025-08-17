import { reviewModel } from "../../../DB/models/reviews.model.js"; // Adjust path if needed
import { asyncHandler } from "../../utils/erroHandling.js"; // Adjust path if needed
import { pagination } from "../../utils/pagination.js"; // Adjust path if needed

export const createReview = asyncHandler(async (req, res, next) => {
  if (req.isteacher) {
    return next(new Error("Only students can create a review.", { cause: 403 }));
  }

  // The 'unique' index on `createdBy` handles the check for existing reviews
  // at the database level, which is faster and prevents race conditions.
  const review = await reviewModel.create({
    createdBy: req.user._id,
    rate: req.body.rate,
    description: req.body.description,
  });

  res.status(201).json({ message: "Your review has been submitted for approval.", review });
});

/**
 * @desc    Admin gets all reviews, paginated by the database.
 * @route   GET /api/reviews/all
 * @access  Private (Main Teacher only)
 */
export const getAllReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  const reviews = await reviewModel
    .find({}) // Finds all reviews, regardless of status
    .populate("createdBy", "userName firstName email")
    .sort({ createdAt: -1 }) // Database handles sorting
    .skip(skip)               // Database handles pagination
    .limit(limit);             // Database handles pagination

  res.status(200).json({ message: "All reviews fetched successfully", data: reviews });
});

/**
 * @desc    Public endpoint to get ONLY published reviews.
 * @route   GET /api/reviews
 * @access  Public
 * @note    This query is extremely fast due to the database index on 'status'.
 */
export const getPublishedReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  const reviews = await reviewModel
    .find({ status: 'published' }) // Ultra-fast indexed query
    .populate("createdBy", "userName firstName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({ message: "Published reviews fetched", data: reviews });
});

/**
 * @desc    Admin updates the status of a single review.
 * @route   PATCH /api/reviews/:reviewId/status
 * @access  Private (Main Teacher only)
 */
export const updateReviewStatus = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;
  const { status } = req.body; // Client only needs to send the target status

  const review = await reviewModel.findByIdAndUpdate(
    reviewId,
    { status }, // A single, atomic update
    { new: true, runValidators: true } // runValidators ensures the new status is valid
  );

  if (!review) {
    return next(new Error("Review not found.", { cause: 404 }));
  }

  res.status(200).json({ message: `Review status updated to '${status}'.`, review });
});

/**
 * @desc    Admin deletes a review.
 * @route   DELETE /api/reviews/:reviewId
 * @access  Private (Main Teacher only)
 */
export const deleteReview = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;
  const review = await reviewModel.findByIdAndDelete(reviewId);

  if (!review) {
    return next(new Error("Review not found.", { cause: 404 }));
  }

  res.status(200).json({ message: "Review deleted successfully." });
});