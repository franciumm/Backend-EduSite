import mongoose from 'mongoose';
import fs from 'fs';
import slugify from 'slugify';
import { asyncHandler } from '../../../utils/erroHandling.js';
import MaterialModel from '../../../../DB/models/material.model.js';
import { groupModel } from '../../../../DB/models/groups.model.js';
import studentModel from '../../../../DB/models/student.model.js';
import { getPresignedUrlForS3, deleteFileFromS3,uploadFileToS3 } from '../../../utils/S3Client.js';
import { gradeModel} from "../../../../DB/models/grades.model.js";

import { pagination } from '../../../utils/pagination.js';
import materialModel from '../../../../DB/models/material.model.js';


export const viewGroupsMaterial = asyncHandler(async (req, res, next) => {
  // 1. Get groupId from request parameters, as defined in the route.
  const { groupId } = req.params;

  if (!groupId) {
    // This check is good practice, though a route like '/group/:groupId'
    // usually won't match if the ID is missing.
    return next(new Error("Group ID is required.", { cause: 400 }));
  }

  // 2. Authorization check for students.
  // We assume an 'isAuth' middleware has populated req.user and req.isTeacher.
  if (req.isTeacher === false) {
    // A student can only view materials for the group they are in.
    // We assume the student's group ID is available in req.user.groupId after auth.
    // NOTE: If a student can be in multiple groups, req.user.groups should be an array
    // and the logic would be: !req.user.groups.includes(groupId)
    const groupId = await studentModel.findById(req.user._id).groupId;
    req.user.groupId = groupId;
    
    if (req.user.groupId.toString() !== groupId) {
      return next(new Error("Unauthorized: You do not have access to this group's materials.", { cause: 403 }));
    }
  }

  // 3. Database Query: Find all materials where the 'groupIds' array contains the requested groupId.
  // Mongoose handles searching for an element within an array field directly.
  const materials = await materialModel.find({ groupIds: groupId });

  // 4. Send a success response.
  // Use 200 OK for a successful GET request.
  res.status(200).json({ message: "Materials fetched successfully for the group", data: materials });
});


function generateSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

export const createMaterial = asyncHandler(async (req, res, next) => {
    const userId = req.user._id;
    const { name, description, gradeId } = req.body;

    // 1) Validate inputs and files
    const gradeDoc = await gradeModel.findById(gradeId);
    if (!gradeDoc) return next(new Error("Wrong GradeId", { cause: 400 }));

    let raw = req.body.groupIds ?? req.body["groupIds[]"];
    if (!raw) return next(new Error("Group IDs are required", { cause: 400 }));
    if (typeof raw === "string" && raw.trim().startsWith("[")) {
        try { raw = JSON.parse(raw); } catch {}
    }
    const groupIdsArray = Array.isArray(raw) ? raw : [raw];
    if (groupIdsArray.length === 0) return next(new Error("At least one Group ID is required", { cause: 400 }));

    if (!req.files || req.files.length === 0) {
        return next(new Error("Please upload at least one file.", { cause: 400 }));
    }

    const uploadedFilesData = [];
    const successfulS3Keys = [];

    try {
        // 2) Upload all files to S3 in parallel for efficiency
        const uploadPromises = req.files.map(async (file) => {
            const fileContent = fs.readFileSync(file.path);
            const s3Key = `materials/${name.replace(/\s+/g, '_')}/${Date.now()}-${file.originalname}`;
            
            await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, file.mimetype);
            successfulS3Keys.push(s3Key); // Track for potential rollback

            return {
                key: s3Key,
                path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
                originalName: file.originalname,
                fileType: file.mimetype,
            };
        });

        const resolvedFiles = await Promise.all(uploadPromises);
        uploadedFilesData.push(...resolvedFiles);

        // 3) Create the database record with all file data
        const newMaterial = await MaterialModel.create({
            name,
            description,
            groupIds: groupIdsArray,
            gradeId,
            createdBy: userId,
            bucketName: process.env.S3_BUCKET_NAME,
            files: uploadedFilesData,
        });

        res.status(201).json({
            message: "Material created and files uploaded successfully",
            material: newMaterial
        });
    } catch (err) {
        console.error("Error creating material. Initiating rollback...", err);
        // If any error occurs, delete all files that were successfully uploaded to S3
        if (successfulS3Keys.length > 0) {
            await Promise.all(
                successfulS3Keys.map(key => deleteFileFromS3(process.env.S3_BUCKET_NAME, key).catch(e => console.error(`S3 rollback failed for key: ${key}`, e)))
            );
        }
        return next(new Error("Failed to create material due to an upload or database error.", { cause: 500 }));
    } finally {
        // 4) Clean up all temporary local files
        if (req.files) {
            req.files.forEach(file => fs.unlink(file.path, (err) => {
                if (err) console.error(`Failed to delete temp file: ${file.path}`, err);
            }));
        }
    }
});


// ── 2) List materials (students & teachers) ────────────────────────────────────
export const getMaterials = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 4 } = req.query;
  const userId     = req.user._id;
  const isTeacher  = req.isteacher.teacher;

  let filter = { /* only show uploaded ones */ };

  if (!isTeacher) {
    // grab the student’s groupId
    const student = await studentModel.findById(userId).select('groupId');
    if (!student?.groupId) {
      return next(new Error("Student has no group assigned", { cause: 400 }));
    }

    // ensure they’re enrolled (safety check)
    const enrolled = await groupModel.exists({
      _id:            student.groupId,
      enrolledStudents: userId
    });
    if (!enrolled) {
      return next(new Error("You are not authorized to access these materials", { cause: 403 }));
    }

    // only materials whose groupIds array includes their group
    filter = { groupIds: student.groupId };
  }

  // always filter by status
  filter.status = "Uploaded";

  const { limit, skip } = pagination({ page, size });
  const materials        = await MaterialModel.find(filter)
    .select("name description createdAt path")
    .skip(skip)
    .limit(limit)
    .lean();
  const totalMaterials   = await MaterialModel.countDocuments(filter);

  res.status(200).json({
    message:   "Materials retrieved successfully",
    materials,
    pagination: {
      currentPage: Number(page),
      totalPages:  Math.ceil(totalMaterials / size),
      totalMaterials,
    },
  });
});




export const viewMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;
    const material = await MaterialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found", { cause: 404 }));
    }

    if (!req.isteacher.teacher) {
        const student = await studentModel.findById(req.user._id).select('groupId').lean();
        if (!student?.groupId || !material.groupIds.includes(student.groupId)) {
            return next(new Error("You are not authorized to view this material", { cause: 403 }));
        }
    }

    // Generate a presigned URL for each file in the material
    const urlGenerationPromises = material.files.map(file =>
        getPresignedUrlForS3(material.bucketName, file.key, 60 * 30) // 30-minute expiry
    );
    const presignedUrls = await Promise.all(urlGenerationPromises);

    const filesWithUrls = material.files.map((file, index) => ({
        originalName: file.originalName,
        url: presignedUrls[index]
    }));

    res.status(200).json({
        message: "Material is ready for viewing",
        name: material.name,
        description: material.description,
        files: filesWithUrls,
    });
});

  

// export const getMaterials = asyncHandler(async (req, res, next) => {
//   const { page = 1, size = 4 } = req.query; // Pagination defaults
//   const {  _id, isteacher } = req.user; // User info from middleware
//   const student = await studentModel.findById(_id);
//   const groupId = student.groupId;
//   try {
//     // Students: Ensure access is restricted to their group only
//     if (!isteacher) {
//       const groupExists = await groupModel.findOne({ _id: groupId, enrolledStudents: _id });
//       if (!groupExists) {
//         return next(new Error("You are not authorized to access these materials", { cause: 403 }));
//       }
//     }

//     // Pagination calculation
//     const { limit, skip } = pagination({ page, size });

//     // Fetch materials for the group
//     const materials = await MaterialModel.find({ groupId, status: "Uploaded" }) // Only "Uploaded" materials
//       .select("name description createdAt path")
//       .skip(skip)
//       .limit(limit)
//       .lean();

//     // Count total materials
//     const totalMaterials = await MaterialModel.countDocuments({ groupId, status: "Uploaded" });

//     res.status(200).json({
//       message: "Materials retrieved successfully",
//       materials,
//       pagination: {
//         currentPage: page,
//         totalPages: Math.ceil(totalMaterials / size),
//         totalMaterials,
//       },
//     });
//   } catch (error) {
//     console.error("Error retrieving materials:", error);
//     next(new Error("Error retrieving materials", { cause: 500 }));
//   }
// });




// Delete Material (Teachers Only)


export const deleteMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;
    const material = await MaterialModel.findById(materialId);

    if (!material) {
        return next(new Error("Material not found", { cause: 404 }));
    }

    // Delete all associated files from S3 in parallel
    if (material.files && material.files.length > 0) {
        const deletePromises = material.files.map(file =>
            deleteFileFromS3(material.bucketName, file.key)
        );
        await Promise.all(deletePromises).catch(err => {
            console.error("Error during S3 multi-file delete, but proceeding with DB deletion:", err);
        });
    }

    // Delete the material record from the database
    await MaterialModel.findByIdAndDelete(materialId);

    res.status(200).json({ message: "Material and all associated files deleted successfully" });
});
