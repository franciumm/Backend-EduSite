import { Router } from "express";
import * as assistantController from "./controller/assistant.controller.js";
import { AdminAuth } from "../../middelwares/auth.js";

const router = Router();

/**
 * @description This is the most critical security feature of the entire module.
 * `router.use(AdminAuth)` applies the AdminAuth middleware to EVERY route defined
 * below it in this file. This guarantees that no request can even reach the
 * controller functions unless the user has already been verified as a 'main_teacher'.
 */
router.use(AdminAuth);

// All the following routes are now implicitly protected by AdminAuth.
router.post('/create', AdminAuth,assistantController.createAssistant);
router.get('/all', AdminAuth,assistantController.getAllAssistants);
router.get('/:assistantId',AdminAuth, assistantController.getAssistantById);
router.put('/:assistantId/permissions',AdminAuth, assistantController.updateAssistantPermissions);
router.delete('/:assistantId', AdminAuth, assistantController.deleteAssistant);

export default router;