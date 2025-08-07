import { Router } from "express";
import * as assistantController from "./controller/assistant.controller.js";
import { AdminAuth } from "../../middelwares/auth.js";

const router = Router();


// All the following routes are now implicitly protected by AdminAuth.
router.post('/create', AdminAuth,assistantController.createAssistant);
router.get('/all', AdminAuth,assistantController.getAllAssistants);
router.get('/:assistantId',AdminAuth, assistantController.getAssistantById);
router.put('/:assistantId/permissions',AdminAuth, assistantController.updateAssistantPermissions);
router.delete('/:assistantId', AdminAuth, assistantController.deleteAssistant);

export default router;