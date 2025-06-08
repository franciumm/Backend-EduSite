import mongoose from 'mongoose';
import { asyncHandler } from '../../../utils/erroHandling.js';
import MaterialModel from '../../../../DB/models/material.model.js';
import { groupModel } from '../../../../DB/models/groups.model.js';
import studentModel from '../../../../DB/models/student.model.js';
import { getPresignedUrlForS3, deleteFileFromS3 } from '../../../utils/S3Client.js';
import { pagination } from '../../../utils/pagination.js';

// Utility: slug factory (unchanged)
function generateSlug(text) {
  return text.toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// ── 1) Upload URL (teachers only; AdminAuth middleware ensures teacher) ─────────
export const generatePresignedUploadUrl = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;  // guaranteed by AdminAuth
  let groupIds = req.body.groupIds ?? req.body.groupId;  // accept either field

  // Normalize into an array
  if (!groupIds) {
    return next(new Error("At least one groupId is required", { cause: 400 }));
  }
  if (!Array.isArray(groupIds)) {
    groupIds = [groupIds];
  }

  // Validate every ID shape
  for (const id of groupIds) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new Error(`Invalid groupId: ${id}`, { cause: 400 }));
    }
  }

  // Ensure each group actually exists
  const count = await groupModel.countDocuments({ _id: { $in: groupIds } });
  if (count !== groupIds.length) {
    return next(new Error("One or more groupIds do not exist", { cause: 404 }));
  }

  // Generate S3 key & record pending material
  const slug = generateSlug(req.body.name);
  const fileName = `${slug}-${Date.now()}.pdf`;
  const s3Key   = `materials/${fileName}`;
 await uploadFileToS3(
       process.env.S3_BUCKET_NAME,
       s3Key,
       fileContent,
       "application/pdf" // MIME type
     );
 
  const newMaterial = await MaterialModel.create({
    name:        req.body.name,
    description: req.body.description,
    slug,
    groupIds,                // ← array now
    createdBy: userId,
    bucketName: process.env.S3_BUCKET_NAME,
    key:        s3Key,
    path:       `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
  });

  res.status(201).json({
    message:      "Pre-signed URL generated successfully",
    presignedUrl,
    materialId:   newMaterial._id,
  });
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

// ── 3) View one material (URL) ─────────────────────────────────────────────────
export const viewMaterial = asyncHandler(async (req, res, next) => {
  const userId    = req.user._id;
  const isTeacher = req.isteacher.teacher;
  const { materialId } = req.params;

  // fetch it
  const material = await MaterialModel.findById(materialId);
  if (!material) {
    return next(new Error("Material not found", { cause: 404 }));
  }

  if (!isTeacher) {
    // student flow: ensure their group is in material.groupIds
    const student = await studentModel.findById(userId).select('groupId');
    if (!student?.groupId || !material.groupIds.includes(student.groupId)) {
      return next(new Error("You are not enrolled in this group", { cause: 403 }));
    }
  }

  // anyone authorized gets a presigned GET URL
  const presignedUrl = await getPresignedUrlForS3(
    material.bucketName,
    material.key,
    60 * 30
  );
  res.status(200).json({
    message:     "Material is ready for viewing",
    presignedUrl,
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
 
  
  try {
    const material = await MaterialModel.findById(materialId);
    if (!material) {
      return next(new Error("Material not found", { cause: 404 }));
    }

    // Delete from S3
    await deleteFileFromS3(material.bucketName, material.key);

    // Delete from database
    await MaterialModel.findByIdAndDelete(materialId);

    res.status(200).json({ message: "Material deleted successfully" });
  } catch (error) {
    console.error("Error deleting material:", error);
    next(new Error("Error deleting material", { cause: 500 }));
  }
});


