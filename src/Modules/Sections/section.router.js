// src/Modules/Sections/section.router.js

import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import * as sectionController from "./controller/section.controller.js";

const router = Router();

// --- Teacher Routes (Write-Access) ---

// Create a new, empty section container
router.post(
    "/create",
    AdminAuth,
    sectionController.createSection
);

// Update a section by adding/removing links to content
router.put(
    "/:sectionId/update-links",
    AdminAuth,
    sectionController.updateSectionLinks
);
router.post(
    "/:sectionId/create-and-link",
    AdminAuth,
    // We use .any() because it could be a single file for an exam/assignment
    // or multiple files for a material. Our controller will handle the logic.
     multerCloudFunction(allowedExtensions.Files).fields([
        { name: 'assignmentFile', maxCount: 15 },
        { name: 'examFile', maxCount: 15 },
        { name: 'materialFiles', maxCount: 15 } // Materials can have multiple files
    ]),
    sectionController.createAndLinkContent
);
// Delete a section container
router.delete(
    "/:sectionId",
    AdminAuth,
    sectionController.deleteSection
);

// --- Shared Routes (Read-Access for Teachers & Students) ---

// View the aggregated content of a single section
router.get(
    "/:sectionId",
    isAuth,
    sectionController.viewSectionById
);

export default router;