import mongoose from 'mongoose';
import slugify from 'slugify';
import { asyncHandler } from '../../../utils/erroHandling.js';
import materialModel from '../../../../DB/models/material.model.js';
import studentModel from '../../../../DB/models/student.model.js';
import { pagination } from '../../../utils/pagination.js';
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { getPresignedUrlForS3, deleteFileFromS3 } from '../../../utils/S3Client.js';
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from 'nanoid';
import { toZonedTime } from 'date-fns-tz';
import { contentStreamModel } from '../../../../DB/models/contentStream.model.js';

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
});



const propagateMaterialToStreams = async ({ material, session }) => {
    const students = await studentModel.find({ groupId: { $in: material.groupIds } }).select('_id groupId').session(session);

    const streamEntries = students.map(student => ({
        userId: student._id,
        contentId: material._id,
        contentType: 'material',
        gradeId: material.gradeId,
        groupId: student.groupId
    }));

    // Add access for the teacher who created it
    streamEntries.push({
        userId: material.createdBy,
        contentId: material._id,
        contentType: 'material',
        gradeId: material.gradeId,
    });

    if (streamEntries.length > 0) {
        await contentStreamModel.insertMany(streamEntries, { session });
    }
};


// View materials for a specific group

export const viewGroupsMaterial = asyncHandler(async (req, res, next) => {
  const { groupId } = req.params;
  const { page, size } = req.query; // <-- 2. GET PAGE AND SIZE

  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    return next(new Error("Invalid Group ID.", { cause: 400 }));
  }

  const { user, isteacher } = req;
  const uaeTimeZone = "Asia/Dubai";
  const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
  const { limit, skip } = pagination({ page, size }); // Calculate pagination

  let queryFilter = { groupIds: groupId };
  let isAuthorized = false;

  if (isteacher) {
    const permittedGroupIds = user.permissions.materials?.map((id) =>
      id.toString()
    );
    if (
      user.role === "main_teacher" ||
      (user.role === "assistant" && (permittedGroupIds || []).includes(groupId))
    ) {
      isAuthorized = true;
      // For teachers, there's no date filtering at the DB level.
      // They can see all materials, scheduled or not.
    }
  } else {
    // Student authorization and filtering
    if (user.groupId?.toString() === groupId) {
      isAuthorized = true;
      // For students, filter out materials that are not yet published.
      queryFilter.$or = [
        { publishDate: { $exists: false } },
        { publishDate: null },
        { publishDate: { $lte: nowInUAE } },
      ];
    }
  }

  if (!isAuthorized) {
    return next(
      new Error("Unauthorized: You do not have access to this group's materials.", {
        cause: 403,
      })
    );
  }

  // 3. APPLY PAGINATION TO THE QUERY
  let materials = await materialModel
    .find(queryFilter)
    .sort({ createdAt: -1 }) // Sort for consistent results across pages
    .skip(skip)
    .limit(limit)
    .lean();

  // This post-processing logic for teachers now runs on the paginated data, which is efficient.
  if (isteacher) {
    materials = materials.map((material) => {
      const isPublished =
        !material.publishDate || new Date(material.publishDate) <= nowInUAE;
      return {
        ...material,
        status: isPublished
          ? "Published"
          : `Scheduled for ${new Date(material.publishDate).toLocaleDateString(
              "en-GB",
              { timeZone: uaeTimeZone }
            )}`,
        publishDate: material.publishDate,
      };
    });
  }

  // **RESPONSE STRUCTURE PRESERVED**
  res
    .status(200)
    .json({
      message: "Materials fetched successfully for the group.",
      data: materials,
    });
});
// Create material (main_teacher only) - Logic is correct.
export const createMaterial = asyncHandler(async (req, res, next) => {
    const { name, description, gradeId, groupIds, linksArray, files, publishDate } = req.body;
    const teacherId = req.user._id;

    if (!files || files.length === 0 || !name || !gradeId) {
        return next(new Error("Name, gradeId, and at least one file are required.", { cause: 400 }));
    }

    const slug = slugify(name, { lower: true, strict: true });
    const existingMaterial = await materialModel.findOne({ slug, gradeId });
    if (existingMaterial) {
        return next(new Error(`A material with the name "${name}" already exists for this grade.`, { cause: 409 }));
    }

   const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const [newMaterial] = await materialModel.create([{
            name, slug, description, linksArray, groupIds, gradeId,
            createdBy: teacherId,
            bucketName: process.env.S3_BUCKET_NAME,
            files: files,
            publishDate: publishDate || null
        }], { session });

        // *** NEW STEP: Propagate to ContentStream ***
        await propagateMaterialToStreams({ material: newMaterial, session });

        await session.commitTransaction();
        res.status(201).json({ message: "Material created successfully", material: newMaterial });

    } catch (error) {
        await session.abortTransaction();
        // Re-throw the error to be handled by the global error handler
        return next(new Error("Failed to create material due to a server error.", { cause: 500 }));
    } finally {
        await session.endSession();
    }
});


// Generate a presigned URL for S3 upload (main_teacher only) - Logic is correct.
export const generateUploadUrl = asyncHandler(async (req, res, next) => {
    const { fileName, fileType, materialName } = req.body;
    if (!fileName || !fileType || !materialName) {
        return next(new Error("fileName, fileType, and materialName are required.", { cause: 400 }));
    }

    const slug = slugify(materialName, { lower: true, strict: true });
    const s3Key = `materials/${slug}/${nanoid()}-${fileName}`;

    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    res.status(200).json({ message: "Upload URL generated successfully.", uploadUrl, s3Key });
});

// List materials based on user's role and permissions - Logic is correct.
export const getMaterials = asyncHandler(async (req, res, next) => {
    const { page = 1, size = 20 } = req.query;
    const { user, isteacher } = req;
    const uaeTimeZone = 'Asia/Dubai';
    const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
const streamItems = await contentStreamModel.find({
        userId: user._id,
        contentType: 'material'
    }).lean();
    const materialIds = streamItems.map(item => item.contentId);

    if (materialIds.length === 0) {
        return res.status(200).json({ message: "No materials found.", materials: [], pagination: { currentPage: 1, totalPages: 0, totalMaterials: 0 } });
    }    
    
    let filter = { _id: { $in: materialIds } };
 if (!isteacher) {
        filter.$or = [
            { publishDate: { $exists: false } },
            { publishDate: null },
            { publishDate: { $lte: nowInUAE } }
        ];
    }
        const { limit, skip } = pagination({ page, size });

  const [materials, totalMaterials] = await Promise.all([
        materialModel.find(filter)
            .select(isteacher ? "name description createdAt publishDate" : "name description createdAt")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        materialModel.countDocuments(filter)
    ]);

   let processedMaterials = materials;
    if (isteacher) {
        processedMaterials = materials.map(material => {
            const isPublished = !material.publishDate || new Date(material.publishDate) <= nowInUAE;
            return {
                ...material,
                status: isPublished ? 'Published' : `Scheduled for ${new Date(material.publishDate).toLocaleDateString('en-GB', { timeZone: uaeTimeZone })}`,
                publishDate: material.publishDate
            };
        });
    }
   
    res.status(200).json({
        message: "Materials retrieved successfully",
        materials,
        pagination: {
            currentPage: Number(page),
            totalPages: Math.ceil(totalMaterials / size),
            totalMaterials:totalMaterials,
        },
    });
});

// View a single material with its files
export const viewMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(materialId)) {
        return next(new Error("Invalid Material ID.", { cause: 400 }));
    }

    const hasAccess = await canAccessContent({
        user: req.user,
        isTeacher: req.isteacher,
        contentId: materialId,
        contentType: 'material'
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to view this material.", { cause: 403 }));
    }

    const material = await materialModel.findById(materialId).lean(); // **FIX**: Use .lean()
    if (!material) {
        return next(new Error("Material not found.", { cause: 404 }));
    }

    if (!req.isteacher && material.publishDate) {
        const uaeTimeZone = 'Asia/Dubai';
        const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
        if (new Date(material.publishDate) > nowInUAE) {
            return next(new Error("You are not authorized to view this material yet.", { cause: 403 }));
        }
    }

    const urlGenerationPromises = material.files.map(file =>
        getPresignedUrlForS3(material.bucketName, file.key)
    );
    const presignedUrls = await Promise.all(urlGenerationPromises);

    const filesWithUrls = material.files.map((file, index) => ({
        originalName: file.originalName,
        url: presignedUrls[index]
    }));

    // **FIX**: Build the response object manually to preserve structure.
    const responseData = {
        message: "Material is ready for viewing",
        name: material.name,
        Links: material.linksArray,
        description: material.description,
        files: filesWithUrls,
    };

    if (req.isteacher) {
        const uaeTimeZone = 'Asia/Dubai';
        const nowInUAE = toZonedTime(new Date(), uaeTimeZone);
        const isPublished = !material.publishDate || new Date(material.publishDate) <= nowInUAE;
        responseData.status = isPublished ? 'Published' : `Scheduled for ${new Date(material.publishDate).toLocaleDateString('en-GB', { timeZone: uaeTimeZone })}`;
        responseData.publishDate = material.publishDate;
    }
    
    // **RESPONSE STRUCTURE PRESERVED**
    res.status(200).json(responseData);
});

// Edit material details
export const editMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;
    const { name, description, gradeId, groupIds, linksArray, files, publishDate } = req.body;

    if (!mongoose.Types.ObjectId.isValid(materialId)) {
        return next(new Error("Invalid Material ID.", { cause: 400 }));
    }

    const material = await materialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found.", { cause: 404 }));
    }

    const updateData = {};
    if (name) {
        updateData.name = name;
        updateData.slug = slugify(name, { lower: true, strict: true });
    }
    // **FIX**: Allow updating description to an empty string.
    if (description !== undefined) updateData.description = description;
    if (gradeId) updateData.gradeId = gradeId;
    if (groupIds) updateData.groupIds = groupIds;
    if (linksArray) updateData.linksArray = linksArray;
    if (files) updateData.files = files;
    
    // **FIX**: Removed duplicated block.
    if (publishDate !== undefined) {
        updateData.publishDate = publishDate;
    }

    const updatedMaterial = await materialModel.findByIdAndUpdate(
        materialId,
        { $set: updateData },
        { new: true }
    );
    
    // **RESPONSE STRUCTURE PRESERVED**
    res.status(200).json({ message: "Material updated successfully", material: updatedMaterial });
});

// Delete material (main_teacher only) - Logic is correct.
export const deleteMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(materialId)) {
        return next(new Error("Invalid Material ID.", { cause: 400 }));
    }
    
    const material = await materialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found.", { cause: 404 }));
    }
      await contentStreamModel.deleteMany({ contentId: materialId, contentType: 'material' });

    await material.deleteOne();

    res.status(200).json({ message: "Material deleted successfully" });
});