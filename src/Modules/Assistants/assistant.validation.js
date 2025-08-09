import Joi from 'joi';

// A reusable schema for validating MongoDB ObjectIDs.
const objectId = Joi.string().hex().length(24);

// A reusable schema for validating headers to ensure the authorization token is present.
export const headers = Joi.object({
    authorization: Joi.string().required().pattern(/^MonaEdu [a-zA-Z0-9-_.]+$/)
}).unknown(true); // Allow other headers

export const createAssistant = Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

export const getOrDeleteAssistantById = Joi.object({
    assistantId: objectId.required()
});

export const updateAssistantPermissions = Joi.object({
    assistantId: objectId.required(),
    permissions: Joi.object({
        assignments: Joi.array().items(objectId).unique().default([]),
        sections: Joi.array().items(objectId).unique().default([]),
        groups: Joi.array().items(objectId).unique().default([]),
        exams: Joi.array().items(objectId).unique().default([]),
        materials: Joi.array().items(objectId).unique().default([])
    }).required()
});