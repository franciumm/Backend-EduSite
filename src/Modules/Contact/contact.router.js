import { Router } from "express";
import * as contactController from "./contact.controller.js";
import { isAuth } from "../../middelwares/auth.js";
import isValid from "../../middelwares/JoiValidation.js";
import * as validators from "./contact.validation.js";
import { generalLimiter } from "../../middelwares/ratelimiter.js";

const router = Router();

// Endpoint for ANYONE (student, parent, public) to submit the form
router.post(
    '/',
    generalLimiter, // Prevent spam
    isValid(validators.createMessageSchema),
    contactController.createContactMessage
);

// Endpoint for TEACHERS and ASSISTANTS to view all submissions
router.get(
    '/',
    isAuth, // Must be authenticated
    isValid(validators.getMessagesSchema, "query"),
    contactController.getAllContactMessages
);

// Endpoint for TEACHERS and ASSISTANTS to update a message's status
router.patch(
    '/:contactId/status',
    isAuth,
    isValid(validators.updateStatusSchema),
    contactController.updateStatus
);

// Endpoint for TEACHERS and ASSISTANTS to delete a message
router.delete(
    '/:contactId',
    isAuth,
    isValid(validators.deleteMessageSchema),
    contactController.deleteMessage
);

export default router;