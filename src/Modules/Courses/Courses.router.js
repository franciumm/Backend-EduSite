import { Router } from "express";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";

import { isAuth,AdminAuth } from "../../middelwares/auth.js";
import { creationValidator } from "../../middelwares/creationValidator.js";
import { CONTENT_TYPES } from "../../utils/constants.js";
import { create, GetAll } from "./controller.js";
import { createRequestLimiter } from "../../middelwares/ratelimiter.js";

const router = Router();


router.get("/all", AdminAuth , GetAll);
router.post("/create",createRequestLimiter , create );
router.delete("/", AdminAuth, deleteCourse); 

export default router ;



