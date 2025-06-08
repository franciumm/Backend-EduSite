import { asyncHandler } from "../../../utils/erroHandling.js";
import MaterialModel  from "../../../../DB/models/material.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { getPresignedUrlForS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";



function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')       // spaces → hyphens
    .replace(/[^\w\-]+/g, '')   // remove non-word chars
    .replace(/\-\-+/g, '-');    // collapse multiple hyphens
}

export const generatePresignedUploadUrl = asyncHandler(async (req, res, next) => {
    const { _id } = req.user; // User data from middleware
    const { name, description, groupIds } = req.body;

  if (!groupIds) {
    return next(new Error("At least one groupId is required", { cause: 400 }));
  }
 if (typeof groupIds === "string") {
    groupIds = [groupIds];
  }  
  if (!Array.isArray(groupIds)) {
    return next(new Error("groupIds must be a string or an array of strings", { cause: 400 }));
  }
    if (groupIds.length === 0) {
    return next(new Error("At least one groupId is required", { cause: 400 }));
  }
    const slug = generateSlug(name);
  
    // Generate a unique filename for the material
    const fileName = `${name}-${Date.now()}.pdf`;
    const s3Key = `Materials/${fileName}`;
  
    try {
      // Generate a pre-signed URL for the client to upload directly to S3
      const presignedUrl = await getPresignedUrlForS3(
        process.env.S3_BUCKET_NAME,
        s3Key,
        "application/pdf",
        60 * 10 // URL valid for 10 minutes
      );
  
  
  const newMaterial = await MaterialModel.create({
    name,
    slug,              
    description,
    groupIds,
    createdBy: _id,
    bucketName: process.env.S3_BUCKET_NAME,
    key: s3Key,
    path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
    status: "Pending Upload",
  });
      res.status(201).json({
        message: "Pre-signed URL generated successfully",
        presignedUrl,
        materialId: newMaterial._id,
      });
    } catch (error) {
      console.error("Error generating pre-signed URL:", error);
      next(new Error("Error generating pre-signed URL", { cause: 500 }));
    }
  });
  

  
export const getMaterials = asyncHandler(async (req, res, next) => {
  // 1️⃣ Pagination & user info
  const { page = 1, size = 4 } = req.query;
  const userId    = req.user._id;
  const isTeacher = req.isteacher.teacher;

  let studentGroupId;
  if (!isTeacher) {
    // 2️⃣ Grab the student’s group
    const student = await studentModel.findById(userId).select('groupId');
    studentGroupId = student.groupId;

    // 3️⃣ Classic access check
    const isEnrolled = await groupModel.exists({
      _id: studentGroupId,
      enrolledStudents: userId
    });
    if (!isEnrolled) {
      return next(new Error("You are not authorized to access these materials", { cause: 403 }));
    }
  }

  // 4️⃣ Compute limit & skip
  const { limit, skip } = pagination({ page, size });

  // 5️⃣ Build our filter: always status=Uploaded, plus groupIds check for students
  const filter = { status: 'Uploaded' };
  if (!isTeacher) {
    // Mongo treats field: value on an array as “array contains that value”
    filter.groupIds = studentGroupId;
  }

  // 6️⃣ Fetch & count
  const materials = await MaterialModel.find(filter)
    .select('name description createdAt path')
    .skip(skip)
    .limit(limit)
    .lean();

  const totalMaterials = await MaterialModel.countDocuments(filter);

  // 7️⃣ Respond old-school style
  res.status(200).json({
    message: "Materials retrieved successfully",
    materials,
    pagination: {
      currentPage: Number(page),
      totalPages:  Math.ceil(totalMaterials / size),
      totalMaterials,
    },
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



// Controller to generate pre-signed URL for viewing material
export const viewMaterial = asyncHandler(async (req, res, next) => {
    const { _id, isteacher } = req.user; // User data from middleware
    const { materialId } = req.params; // Material ID from URL params
  
    // Find the material by ID
    const material = await MaterialModel.findById(materialId);
    if (!material) {
      return next(new Error("Material not found", { cause: 404 }));
    }
  
    // Check if the user is a teacher or a student
    if (isteacher) {
      // If the user is a teacher, they can view any material
      try {
        const presignedUrl = await getPresignedUrlForS3(
          material.bucketName,
          material.key,
          60 * 30 // URL valid for 10 minutes
        );
  
        res.status(200).json({
          message: "Material is ready for viewing",
          presignedUrl,
        });
      } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        next(new Error("Error generating pre-signed URL", { cause: 500 }));
      }
    } else {
      // If the user is a student, check if they are part of the group
      const student = await groupModel
        .findById(material.groupId)
        .populate("enrolledStudents");
  
      if (!student || !student.enrolledStudents.some((s) => s._id.toString() === _id.toString())) {
        // If the student is not enrolled in the group
        return next(new Error("You are not enrolled in this group", { cause: 403 }));
      }
  
      // Generate a pre-signed URL for the student to view the material
      try {
        const presignedUrl = await getPresignedUrlForS3(
          material.bucketName,
          material.key,
          60 * 30 // URL valid for 10 minutes
        );
  
        res.status(200).json({
          message: "Material is ready for viewing",
          presignedUrl,
        });
      } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        next(new Error("Error generating pre-signed URL", { cause: 500 }));
      }
    }
  });