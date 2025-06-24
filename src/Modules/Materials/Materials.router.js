import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import * as materialsController from "./controller/All.js";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";

const router = Router();

 // Create materials for a group (teachers)
router.post(
    "/create",
    AdminAuth, 
     multerCloudFunction(allowedExtensions.Files).array("files", 10), 
    materialsController.createMaterial
  );
  



  // Get materials for a group (students and teachers)
 router.get(
    "/",
    isAuth, // Ensure user is authenticated
    materialsController.getMaterials
  );
  // router.get("details/:materialId",isAuth,materialsController.MaterialDetails)

// Route to view material (students can view if enrolled, teachers can view any)
router.get('/:materialId', isAuth, materialsController.viewMaterial);
router.get('/group/:groupId', isAuth, materialsController.viewGroupsMaterial);

  // Delete a material by its ID (teachers only)
  router.delete(
    "/:materialId",
    AdminAuth, // Ensure user is authenticated
    materialsController.deleteMaterial
  );
export default router ;