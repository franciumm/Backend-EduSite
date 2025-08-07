// src/Modules/Sections/section.router.js

import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import * as sectionController from "./controller/section.controller.js";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";

const router = Router();

// --- Routes without parameters ---

router.get(
    "/",
    isAuth,
    sectionController.getSections
);

// Create a new, empty section container
router.post(
    "/create",
    isAuth,
    sectionController.createSection
);

// --- Routes with parameters ---



// Update a section by adding/removing links to its content
router.put(
    "/:sectionId/update-links",
    isAuth,
    sectionController.updateSectionLinks
);

// Delete a specific section container
router.delete(
    "/:sectionId",
    isAuth,
    sectionController.deleteSection
);

// Get the aggregated content and details of a specific section
// This is the most generic GET route with a parameter, so it comes last.
router.get(
    "/:sectionId",
    isAuth,
    sectionController.viewSectionById
);

export default router;
