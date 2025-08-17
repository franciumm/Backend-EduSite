import { reviewModel } from "../../../DB/models/reviews.model.js"; // Adjust path if needed
import { asyncHandler } from "../../utils/erroHandling.js"; // Adjust path if needed
import { pagination } from "../../utils/pagination.js"; // Adjust path if needed

/**
 * @desc    Student creates a review
 * @route   POST /api/reviews
 * @access  Private (Students only)
 */
export const createReview = asyncHandler(async (req, res, next) => {
  // Ensure the user is a student
  if (req.isteacher) {
    return next(new Error("Only students can create a review.", { cause: 403 }));
  }

  const { rate, description } = req.body;
  const studentId = req.user._id;

  // Check if the student has already submitted a review
  const existingReview = await reviewModel.findOne({ createdBy: studentId });
  if (existingReview) {
    return next(
      new Error("You have already submitted a review.", { cause: 409 }) // 409 Conflict
    );
  }

  const review = await reviewModel.create({
    createdBy: studentId,
    rate,
    description,
  });

  res
    .status(201)
    .json({ message: "Your review has been submitted successfully.", review });
});

/**
 * @desc    Admin gets all reviews (published and unpublished)
 * @route   GET /api/reviews/all
 * @access  Private (Main Teacher only)
 */
export const getAllReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  const reviews = await reviewModel
    .find({})
    .populate("createdBy", "userName firstName lastName email") // Populate student info
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.status(200).json({ message: "Reviews fetched successfully", data: reviews });
});

/**
 * @desc    Anyone can view published reviews for the landing page
 * @route   GET /api/reviews
 * @access  Public
 */
export const getPublishedReviews = asyncHandler(async (req, res, next) => {
  const { limit, skip } = pagination(req.query);

  const reviews = await reviewModel
    .find({ isPublished: true })
    .populate("createdBy", "userName firstName") // Populate only essential info
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res
    .status(200)
    .json({ message: "Published reviews fetched", data: reviews });
});

/**
 * @desc    Admin publishes or unpublishes a review
 * @route   PATCH /api/reviews/:reviewId/status
 * @access  Private (Main Teacher only)
 */
export const updateReviewStatus = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;
  const { isPublished } = req.body;

  if (typeof isPublished !== "boolean") {
    return next(
      new Error("isPublished must be a boolean value (true or false).", {
        cause: 400,
      })
    );
  }

  const review = await reviewModel.findByIdAndUpdate(
    reviewId,
    { isPublished },
    { new: true }
  );

  if (!review) {
    return next(new Error("Review not found.", { cause: 404 }));
  }

  res.status(200).json({
    message: `Review has been ${
      isPublished ? "published" : "unpublished"
    }.`,
    review,
  });
});

/**
 * @desc    Admin deletes a review
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