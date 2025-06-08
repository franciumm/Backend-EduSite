import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth.js";
import * as materialsController from "./controller/All.js";
import { multerCloudFunction } from "../../utils/MulterCloud.js";
import { allowedExtensions } from "../../utils/allowedExtensions.js";

const router = Router();

 // Create materials for a group (teachers)
router.post(
    "/create",
    AdminAuth,multerCloudFunction(allowedExtensions.Files).single("file"), // Ensure user is authenticated
    materialsController.createMaterial
  );
  



  // Get materials for a group (students and teachers)
 router.get(
    "/",
    isAuth, // Ensure user is authenticated
    materialsController.getMaterials
  );
  

// Route to view material (students can view if enrolled, teachers can view any)
router.get('/:materialId', isAuth, materialsController.viewMaterial);

  // Delete a material by its ID (teachers only)
  router.delete(
    "/:materialId",
    AdminAuth, // Ensure user is authenticated
    materialsController.deleteMaterial
  );
export default router ;