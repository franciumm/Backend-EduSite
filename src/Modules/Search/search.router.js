// src/Modules/Search/search.router.js

import { Router } from "express";
import { AdminAuth } from "../../middelwares/auth.js";
import * as searchController from "./search.controller.js";

const router = Router();

// This single, powerful endpoint will serve the teacher's entire search UI.
router.get(
    "/content",
    AdminAuth, // Only authenticated teachers can search for content to link
    searchController.findContent
);

export default router;