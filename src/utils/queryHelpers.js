// src/utils/queryHelpers.js
import mongoose from 'mongoose';

/**
 * Creates a Mongoose filter for searching content, intelligently handling
 * schema inconsistencies like the 'Name' vs 'name' fields without altering the DB.
 * This is the "Adapter" that isolates the inconsistent logic.
 * @param {string} type - The type of content ('assignment', 'exam', 'material', etc.).
 * @param {string} searchQuery - The user's search term.
 * @returns {object} A fully formed Mongoose filter object.
 */
export const createContentSearchFilter = (type, searchQuery) => {
    // Base filter with a case-insensitive regex for powerful searching
    const baseFilter = { $regex: searchQuery, $options: 'i' };

    const filter = {};

    // --- The Core Adapter Logic ---
    if (type === 'exam') {
        filter.Name = baseFilter;
    } else {
        filter.name = baseFilter;
    }

    return filter;
};

/**
 * A simple helper to normalize the output name from populated documents,
 * ensuring the frontend always receives a consistent data structure.
 * @param {object} item - A populated document that might have 'name' or 'Name'.
 * @returns {string} The correct name of the item.
 */
export const normalizeContentName = (item) => {
    return item.name || item.Name;
};