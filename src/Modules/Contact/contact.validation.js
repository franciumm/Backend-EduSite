import Joi from 'joi';

const objectId = Joi.string().hex().length(24).required();

// Schema for creating a new contact message
export const createMessageSchema = Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email({ tlds: { allow: true } }).required(),
    phone: Joi.string().max(20).optional().allow(''),
    subject: Joi.string().min(5).max(200).required(),
    message: Joi.string().min(10).max(5000).required()
}).required();

// Schema for fetching messages (validates query params)
export const getMessagesSchema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    size: Joi.number().integer().min(1).max(100).optional(),
    status: Joi.string().valid('pending', 'resolved').optional()
});

// Schema for updating a message's status
export const updateStatusSchema = Joi.object({
    contactId: objectId,
    status: Joi.string().valid('pending', 'resolved').required()
});

// Schema for deleting a message
export const deleteMessageSchema = Joi.object({
    contactId: objectId
});