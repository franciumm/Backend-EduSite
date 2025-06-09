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



function generateSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

export const createMaterial = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  let { name, description, gradeId } = req.body;

  // ── Grade validation (unchanged) ─────────────────────────────────────────────
  const gradedoc = await gradeModel.findById(gradeId);
  if (!gradedoc) {
    return next(new Error("wrong GradeId", { cause: 400 }));
  }

  // ── 1) Normalize & validate groupIds exactly as in createExam ──────────────
  let raw = req.body.groupIds ?? req.body["groupIds[]"];
  if (!raw) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
  }
  // parse JSON-stringified arrays
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      raw = JSON.parse(raw);
    } catch {
      // leave as-is
    }
  }
  // coerce to array
  let groupIds = Array.isArray(raw) ? raw : [raw];

  // array must not be empty
  if (groupIds.length === 0) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
  }
  // must all be valid ObjectIds
  const invalidGroupIds = groupIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
  if (invalidGroupIds.length > 0) {
    return next(new Error(
      `Invalid Group ID(s): ${invalidGroupIds.join(", ")}`,
      { cause: 400 }
    ));
  }
  // cast to ObjectId
  const validGroupIds = groupIds.map(id => new mongoose.Types.ObjectId(id));
  // ensure they all exist
  const existCount = await groupModel.countDocuments({ _id: { $in: validGroupIds } });
  if (existCount !== validGroupIds.length) {
    return next(new Error("One or more Group IDs do not exist", { cause: 404 }));
  }

  // ── 2) File presence & read ───────────────────────────────────────────────────
  if (!req.file) {
    return next(new Error("Please upload a PDF file", { cause: 400 }));
  }
  const fileContent = fs.readFileSync(req.file.path);

  // ── 3) Generate a **unique** slug + S3 key ────────────────────────────────────
  const slug     = generateSlug(`${name}-${Date.now()}`);
  const fileName = `${slug}-${Date.now()}.pdf`;
  const s3Key    = `materials/${fileName}`;

  try {
    // ── 4) Upload to S3 ─────────────────────────────────────────────────────────
    await uploadFileToS3(
      process.env.S3_BUCKET_NAME,
      s3Key,
      fileContent,
      "application/pdf"
    );

    // ── 5) Create DB record with validated groupIds ─────────────────────────────
    const newMaterial = await MaterialModel.create({
      name,
      slug,
      description,
      groupIds: validGroupIds,  // <— use the validated array here
      gradeId,
      createdBy: userId,
      bucketName: process.env.S3_BUCKET_NAME,
      key:        s3Key,
      path:       `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      status:     "Uploaded"
    });

    // ── 6) Success ──────────────────────────────────────────────────────────────
    res.status(201).json({
      message:  "Material uploaded successfully",
      material: newMaterial
    });
  } catch (err) {
    console.error("❌ createMaterial error:", err);
    await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key);
    return next(new Error("Failed to upload material", { cause: 500 }));
  } finally {
    fs.unlinkSync(req.file.path);
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


