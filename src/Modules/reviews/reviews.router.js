import { Router } from "express";
import * as reviewController from "./controller.js"; // Adjust path if needed
import { isAuth, AdminAuth } from "../../middelwares/auth.js"; // Adjust path if needed
import { reviewLimiter, generalLimiter } from "../../middelwares/ratelimiter.js";

const router = Router();

// Public route for landing page, protected by a general limiter
router.get("/", generalLimiter, reviewController.getPublishedReviews);

// Student-only route, protected by the review creation limiter
router.post("/", reviewLimiter, isAuth, reviewController.createReview);

// Admin-only routes (for main_teacher)
router.get("/all", AdminAuth, reviewController.getAllReviews);
router.patch("/:reviewId/status", AdminAuth, reviewController.updateReviewStatus); // Use PATCH for partial updates
router.delete("/:reviewId", AdminAuth, reviewController.deleteReview);

export default router;