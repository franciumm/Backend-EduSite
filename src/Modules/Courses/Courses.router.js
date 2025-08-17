import { Router } from "express";
import isValid from "../../middelwares/JoiValidation.js"; 
import { AdminAuth } from "../../middelwares/auth.js";
import { create, GetAll ,deleteCourse} from "./controller.js";
import { createRequestLimiter } from "../../middelwares/ratelimiter.js";
import { createCourseSchema } from "./Joi.js";

const router = Router();


router.get("/all", AdminAuth , GetAll);
router.post("/create", isValid(createCourseSchema) ,createRequestLimiter, create );
router.delete("/", AdminAuth, deleteCourse); 

export default router ;



