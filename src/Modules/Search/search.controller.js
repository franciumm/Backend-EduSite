// src/Modules/Search/search.controller.js

import { asyncHandler } from '../../utils/erroHandling.js';
import { assignmentModel } from '../../../DB/models/assignment.model.js';
import { examModel } from '../../../DB/models/exams.model.js';
import materialModel from '../../../DB/models/material.model.js';
import { sectionModel } from '../../../DB/models/section.model.js';
import mongoose from 'mongoose';
import { createContentSearchFilter, normalizeContentName } from '../../utils/queryHelpers.js';


const modelMap = {
    assignment: assignmentModel,
    exam: examModel,
    material: materialModel,
    section: sectionModel
};

export const findContent = asyncHandler(async (req, res, next) => {
    const { type, q } = req.query;
    const searchQuery = q ? q.trim() : '';

    if (!type) {
        return next(new Error("A 'type' query parameter (e.g., 'assignment', 'exam') is required.", { cause: 400 }));
    }
 

      const Model = modelMap[type];
    if (!Model) {
        return next(new Error("Invalid content 'type'.", { cause: 400 }));
    }
    // --- REFACTOR: All complex if/else logic is replaced by one call to our smart filter builder. ---
    const filter = createContentSearchFilter(type, searchQuery);

    const results = await Model.find(filter)
        // Select both possible name fields. Mongoose is smart enough to only return the one that exists on the document.
        .select('_id name Name')
        .limit(20) // Keep a reasonable limit for the UI
        .lean();
    
    // Use the normalizer to guarantee a consistent output format for the frontend.
    const normalizedResults = results.map(item => ({
        id: item._id,
        name: normalizeContentName(item)
    }));

    res.status(200).json({
        message: `Search results for '${type}' fetched successfully.`,
        data: normalizedResults,
    });
});