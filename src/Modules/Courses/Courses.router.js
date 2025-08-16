import { Router } from "express";

import { AdminAuth } from "../../middelwares/auth.js";
import { create, GetAll ,deleteCourse} from "./controller.js";
import { createRequestLimiter } from "../../middelwares/ratelimiter.js";

const router = Router();


router.get("/all", AdminAuth , GetAll);
router.post("/create",createRequestLimiter , create );
router.delete("/", AdminAuth, deleteCourse); 

export default router ;



