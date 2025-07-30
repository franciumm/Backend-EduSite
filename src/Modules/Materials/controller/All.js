import mongoose from 'mongoose';
import fs from 'fs';
import slugify from 'slugify';
import { asyncHandler } from '../../../utils/erroHandling.js';
import MaterialModel from '../../../../DB/models/material.model.js';
import { groupModel } from '../../../../DB/models/groups.model.js';
import studentModel from '../../../../DB/models/student.model.js';
import { getPresignedUrlForS3, deleteFileFromS3,uploadFileToS3 } from '../../../utils/S3Client.js';
import { pagination } from '../../../utils/pagination.js';
import materialModel from '../../../../DB/models/material.model.js';
import { gradeModel } from "../../../../DB/models/grades.model.js";
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from 'nanoid';

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
 if (req.isteacher.teacher === false) {
    if (req.user.groupId?.toString() !== groupId) {
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
    // 1. All data now comes from the JSON body, including file info
    const { name, description, gradeId, groupIds, linksArray, files } = req.body;
    const teacherId = req.user._id;

    // 2. The 'files' array is sent by the client after the S3 upload is complete.
    if (!files || files.length === 0) {
        return next(new Error("File information is missing from the request.", { cause: 400 }));
    }
    if (!name || !gradeId) {
        return next(new Error("Material name and grade are required.", { cause: 400 }));
    }

    const slug = slugify(name, { lower: true, strict: true });

    // 3. Check for duplicates like before
    const existingMaterial = await MaterialModel.findOne({ slug, gradeId });
    if (existingMaterial) {
        throw new Error(`A material with the name "${name}" already exists for this grade.`);
    }

    // 4. Create the document in MongoDB with the file info from the client
    const newMaterial = await MaterialModel.create({
        name,
        slug,
        description,
        linksArray,
        groupIds,
        gradeId,
        createdBy: teacherId,
        bucketName: process.env.S3_BUCKET_NAME,
        files: files, // This now comes directly from the request body
    });

    res.status(201).json({
        message: "Material created successfully",
        material: newMaterial
    });
});
export const generateUploadUrl = asyncHandler(async (req, res, next) => {
    // Get details from the frontend's request body
    const { fileName, fileType, materialName } = req.body;

    if (!fileName || !fileType || !materialName) {
        return next(new Error("fileName, fileType, and materialName are required.", { cause: 400 }));
    }

    // Generate a unique file path in S3 to prevent overwrites
    const slug = slugify(materialName, { lower: true, strict: true });
    const uniqueFileName = `${nanoid()}-${fileName}`;
    const s3Key = `materials/${slug}/${uniqueFileName}`;

    // Create a command to put an object in S3
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        ContentType: fileType, // IMPORTANT: The client must send this exact content type
    });

    // Generate the presigned URL which is valid for a short time (e.g., 5 minutes)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    res.status(200).json({
        message: "Upload URL generated successfully.",
        uploadUrl, // The URL the frontend will upload the file to
        s3Key,     // The key of the file in S3, for saving in the database later
    });
});


// ── 2) List materials (students & teachers) ────────────────────────────────────
export const getMaterials = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 20 } = req.query;
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


export const _internalCreateMaterial = async ({ name, description, gradeId, groupIds, linksArray, files, teacherId }) => {
    const gradeDoc = await gradeModel.findById(gradeId);
    if (!gradeDoc) throw new Error("Wrong GradeId");

     const slug = slugify(name, {
      lower: true,     
      strict: true,    
      remove: /[*+~.()'"!:@]/g 
    });
    const existingMaterial = await MaterialModel.findOne({ name,gradeId });
    if (existingMaterial) {
        throw new Error(`A material with the name "${name}" already exists for this grade.`);
    }

    const successfulS3Keys = [];
    const tempFilePaths = files.map(f => f.path);

    try {
        const uploadPromises = files.map(async (file) => {
            const fileContent = fs.readFileSync(file.path);
            const s3Key = `materials/${slug}/${Date.now()}-${file.originalname}`; // Use slug in S3 path
            
            await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, file.mimetype);
            successfulS3Keys.push(s3Key);

            return {
                key: s3Key,
                path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
                originalName: file.originalname,
                fileType: file.mimetype,
            };
        });

        const uploadedFilesData = await Promise.all(uploadPromises);

        // --- FIX: Include the generated slug in the document to be created ---
        const newMaterial = await MaterialModel.create({
            name,
          
            description,
            linksArray,
            groupIds,
            gradeId,
            createdBy: teacherId,
            bucketName: process.env.S3_BUCKET_NAME,
            files: uploadedFilesData,
        });

        return newMaterial;

    } catch (err) {
        // ... (Error handling remains the same)
        console.error("Internal material creation failed. Rolling back S3 files...", err);
        if (successfulS3Keys.length > 0) {
            await Promise.all(
                successfulS3Keys.map(key => deleteFileFromS3(process.env.S3_BUCKET_NAME, key).catch(e => console.error(`S3 rollback failed for key: ${key}`, e)))
            );
        }
        throw err;
    } finally {
        // ... (Cleanup remains the same)
        tempFilePaths.forEach(path => fs.unlink(path, (err) => {
            if (err) console.error(`Failed to delete temp file: ${path}`, err);
        }));
    }
};

export const viewMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;
    let hasAccess = false;

    // --- FIX: Implement Role-Based Access Control ---
    // 1. Check if the user is a teacher. Teachers have universal access to view materials.
    if (req.isteacher.teacher === true) {
        hasAccess = true;
    } 
    // 2. If the user is a student, use the existing authorization logic.
    else {
        hasAccess = await canAccessContent({
            user: { _id: req.user._id, isTeacher: req.isteacher.teacher },
            contentId: materialId,
            contentType: 'material'
        });
    }
    // --- END FIX ---

    // 3. If access is not granted after checking roles, deny the request.
    if (!hasAccess) {
        return next(new Error("You are not authorized to view this material", { cause: 403 }));
    }

    // 4. If access is granted, proceed to fetch and return the material.
    const material = await MaterialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found", { cause: 404 }));
    }

    // Generate a presigned URL for each file in the material
    const urlGenerationPromises = material.files.map(file =>
        getPresignedUrlForS3(material.bucketName, file.key)
    );
    const presignedUrls = await Promise.all(urlGenerationPromises);

    const filesWithUrls = material.files.map((file, index) => ({
        originalName: file.originalName,
        url: presignedUrls[index]
    }));

    res.status(200).json({
        message: "Material is ready for viewing",
        name: material.name,
        Links: material.linksArray,
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
if (material.createdBy.toString() !== req.user._id.toString()) {
        return next(new Error("You are not authorized to delete this material.", { cause: 403 }));
    }

    await material.deleteOne();

    res.status(200).json({ message: "Material and all associated files deleted successfully" });
});
