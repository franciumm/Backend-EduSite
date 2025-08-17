import { Router } from "express";
import * as reviewController from "./controller.js"; // Adjust path if needed
import { isAuth, AdminAuth } from "../../middelwares/auth.js"; // Adjust path if needed
import { reviewLimiter, generalLimiter } from "../../middelwares/ratelimiter.js"; // <-- 1. IMPORT LIMITERS

const router = Router();

// Public route for landing page, protected by a general limiter
router.get("/", generalLimiter, reviewController.getPublishedReviews); // <-- 2. APPLY GENERAL LIMITER

// Student-only route, protected by the new review limiter
router.post("/", reviewLimiter, isAuth, reviewController.createReview); 
// Student-only route

// Admin-only routes (for main_teacher)
router.get("/all", AdminAuth, reviewController.getAllReviews);
router.patch("/:reviewId/status", AdminAuth, reviewController.updateReviewStatus);
router.delete("/:reviewId", AdminAuth, reviewController.deleteReview);

export default router;