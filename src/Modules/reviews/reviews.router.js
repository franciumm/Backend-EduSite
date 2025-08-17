


import { Router } from "express";
import * as reviewController from "./reviews.controller.js"; // Adjust path if needed
import { isAuth, AdminAuth } from "../../middelwares/auth.js"; // Adjust path if needed

const router = Router();

// Public route for landing page
router.get("/", reviewController.getPublishedReviews);

// Student-only route
router.post("/", isAuth, reviewController.createReview);

// Admin-only routes (for main_teacher)
router.get("/all", AdminAuth, reviewController.getAllReviews);
router.patch("/:reviewId/status", AdminAuth, reviewController.updateReviewStatus);
router.delete("/:reviewId", AdminAuth, reviewController.deleteReview);

export default router;