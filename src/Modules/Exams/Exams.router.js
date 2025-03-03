import { Router } from "express";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";
import * as Start from './controller/Start.js';
import * as Edit from "./controller/Edit.js";
import * as Get from "./controller/Get.js"
import { isAuth,AdminAuth } from "../../middelwares/auth.js";
const router = Router();






router.get("", isAuth, Get.getExams);
router.get("/submissions", isAuth, Get.getSubmittedExams);
router.get("/download", isAuth, Edit.downloadExam);
router.get("/submissions/download", isAuth, Edit.downloadSubmittedExam);
router.post ('/create',AdminAuth,multerCloudFunction(allowedExtensions.Files).single('file'),Start.createExam);
router.post("/submit",isAuth,multerCloudFunction(allowedExtensions.Files).single("file"), Start.submitExam);
router.patch("/mark", AdminAuth, multerCloudFunction(allowedExtensions.Files).single("file"),Edit.markSubmissionWithPDF);
router.post("/add-exception",  AdminAuth, Edit.addExceptionStudent);
router.post("/add-rejected", AdminAuth , Edit.addRejectedStudent);
router.delete("/delete", AdminAuth, Edit.deleteExam);




export default router ;



