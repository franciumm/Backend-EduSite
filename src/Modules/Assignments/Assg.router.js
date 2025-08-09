import { Router } from "express";
import * as Start from "./controller/start.js" ;
import* as Edit from "./controller/edit.js";
import * as Get from "./controller/get.js";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import {multerCloudFunction}from '../../utils/MulterCloud.js'
import { allowedExtensions } from "../../utils/allowedExtensions.js";
import { creationValidator } from "../../middelwares/creationValidator.js";
import { CONTENT_TYPES } from "../../utils/constants.js";

const router = Router();

router.delete("/delete", isAuth, Edit.deleteAssignmentWithSubmissions);
router.delete("/submission/delete", isAuth, Edit.deleteSubmittedAssignment);


router.post ('/create',isAuth,
    multerCloudFunction(allowedExtensions.Files).single('file'),
    creationValidator(CONTENT_TYPES.ASSIGNMENT),
    Start.CreateAssignment);
router.post( "/submit", isAuth,  multerCloudFunction(allowedExtensions.Files).single("file"), Start.submitAssignment);
router.put("/edit", isAuth, multerCloudFunction(allowedExtensions.Files).single('file'), Edit.editAssignment);

router.put("/mark", isAuth,  Edit.markAssignment);

router.get("/submissions/View/:assignmentId", isAuth, Get.ViewSub);

router.get("/submissions/download", isAuth, Edit.downloadSubmittedAssignment);
router.get("/submissions", isAuth, Get.findSubmissions);
router.get('/download',isAuth,Edit.downloadAssignment );
router.get('/all',isAuth,Get.getAssignmentsForUser );
router.get('/group/all',isAuth,Get.GetAllByGroup );

export default router ;

