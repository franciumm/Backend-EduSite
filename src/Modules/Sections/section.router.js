// src/Modules/Sections/section.router.js

import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import * as sectionController from "./controller/section.controller.js";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";

const router = Router();

// --- Routes without parameters ---

// Get a paginated list of all sections (with optional filters)
// Must be defined before any routes that use a parameter like '/:sectionId'
router.get(
    "/",
    isAuth,
    sectionController.getSections
);

// Create a new, empty section container
router.post(
    "/create",
    AdminAuth,
    sectionController.createSection
);

// --- Routes with parameters ---

// Create content (e.g., assignment, exam) and link it to a specific section
router.post(
    "/:sectionId/create-and-link",
    AdminAuth,
    multerCloudFunction(allowedExtensions.Files).fields([
        { name: 'assignmentFile', maxCount: 15 },
        { name: 'examFile', maxCount: 15 },
        { name: 'materialFiles', maxCount: 15 }
    ]),
    sectionController.createAndLinkContent
);

// Update a section by adding/removing links to its content
router.put(
    "/:sectionId/update-links",
    AdminAuth,
    sectionController.updateSectionLinks
);

// Delete a specific section container
router.delete(
    "/:sectionId",
    AdminAuth,
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
