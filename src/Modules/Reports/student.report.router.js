import { Router } from "express";
import Joivalidation from "../../middelwares/JoiValidation.js";
import { isAuth } from "../../middelwares/auth.js";
import { reportQuerySchema } from "./report.validation.js";
import { generateStudentReport } from "./controller/student.report.controller.js";

const router = Router();

/**
 * GET /reports/student/:studentId?format=pdf|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD
 * or  /reports/student/:studentId?format=pdf|xlsx&year=2025&fromMonth=2&toMonth=3
 */
router.get(
  "/student/:studentId",
  isAuth,                        // Adjust to your roles if needed (teacher/assistant/main_teacher)
  Joivalidation(reportQuerySchema),
  generateStudentReport
);

export default router;
