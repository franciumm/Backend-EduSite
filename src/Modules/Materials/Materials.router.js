import { Router } from "express";
import { AdminAuth, isAuth } from "../../middelwares/auth";
import * as materialsController from "./controller/All.js";

const router = Router();

 // Create materials for a group (teachers)
router.post(
    "/create",
    AdminAuth, // Ensure user is authenticated
    materialsController.generatePresignedUploadUrl
  );
  



  // Get materials for a group (students and teachers)
 router.get(
    "/",
    isAuth, // Ensure user is authenticated
    materialsController.getMaterials
  );
  

// Route to view material (students can view if enrolled, teachers can view any)
router.get('/materials/:materialId', isAuth, materialsController.viewMaterial);

  // Delete a material by its ID (teachers only)
  router.delete(
    "/:materialId",
    AdminAuth, // Ensure user is authenticated
    materialsController.deleteMaterial
  );
export default router ;