import { Router } from "express";
import * as assistantController from "./controller/assistant.controller.js";
import { AdminAuth } from "../../middelwares/auth.js";
import * as validators from "./assistant.validation.js";
import Joivalidation from "../../middelwares/JoiValidation.js";

const router = Router();


// All the following routes are now implicitly protected by AdminAuth.
router.post('/create',Joivalidation(validators.headers), AdminAuth,Joivalidation(validators.createAssistant),assistantController.createAssistant);
router.get('/all',Joivalidation(validators.headers), AdminAuth,assistantController.getAllAssistants);
router.get('/:assistantId',
    Joivalidation(validators.headers),
    AdminAuth,
     Joivalidation(validators.getOrDeleteAssistantById),
 assistantController.getAssistantById);



 router.put('/:assistantId/permissions',
        Joivalidation(validators.headers),

    AdminAuth, 
    Joivalidation(validators.updateAssistantPermissions),
    assistantController.updateAssistantPermissions);



router.delete('/:assistantId',     Joivalidation(validators.headers),
AdminAuth,
Joivalidation(validators.getOrDeleteAssistantById),
assistantController.deleteAssistant);

export default router;