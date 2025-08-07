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

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
});

// View materials for a specific group
export const viewGroupsMaterial = asyncHandler(async (req, res, next) => {
    const { groupId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
        return next(new Error("Invalid Group ID.", { cause: 400 }));
    }

    const { user, isteacher } = req;
    let isAuthorized = false;

    if (isteacher) {
        if (user.role === 'main_teacher') {
            isAuthorized = true;
        } else if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.materials?.map(id => id.toString()) || [];
            if (permittedGroupIds.includes(groupId)) {
                isAuthorized = true;
            }
        }
    } else {
        if (user.groupId?.toString() === groupId) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return next(new Error("Unauthorized: You do not have access to this group's materials.", { cause: 403 }));
    }

    const materials = await materialModel.find({ groupIds: groupId });
    res.status(200).json({ message: "Materials fetched successfully for the group.", data: materials });
});

// Create material (main_teacher only)
export const createMaterial = asyncHandler(async (req, res, next) => {
    const { name, description, gradeId, groupIds, linksArray, files } = req.body;
    const teacherId = req.user._id;

    if (!files || files.length === 0 || !name || !gradeId) {
        return next(new Error("Name, gradeId, and at least one file are required.", { cause: 400 }));
    }

    const slug = slugify(name, { lower: true, strict: true });
    const existingMaterial = await materialModel.findOne({ slug, gradeId });
    if (existingMaterial) {
        return next(new Error(`A material with the name "${name}" already exists for this grade.`, { cause: 409 }));
    }

    const newMaterial = await materialModel.create({
        name,
        slug,
        description,
        linksArray,
        groupIds,
        gradeId,
        createdBy: teacherId,
        bucketName: process.env.S3_BUCKET_NAME,
        files: files,
    });

    res.status(201).json({ message: "Material created successfully", material: newMaterial });
});

// Generate a presigned URL for S3 upload (main_teacher only)
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

// List materials based on user's role and permissions
export const getMaterials = asyncHandler(async (req, res, next) => {
    const { page = 1, size = 20 } = req.query;
    const { user, isteacher } = req;

    let filter = {};

    if (isteacher) {
     
        if (user.role === 'assistant') {
            const permittedGroupIds = user.permissions.materials || [];
            if (permittedGroupIds.length === 0) {
                return res.status(200).json({ message: "No materials found.", materials: [], pagination: { currentPage: 1, totalPages: 0, totalMaterials: 0 } });
            }
            filter = { groupIds: { $in: permittedGroupIds } };
        }
    } else {
        const student = await studentModel.findById(user._id).select('groupId').lean();
        if (!student?.groupId) {
            return next(new Error("Student is not assigned to any group.", { cause: 400 }));
        }
        filter = { groupIds: student.groupId };
    }

    const { limit, skip } = pagination({ page, size });
    const materials = await materialModel.find(filter)
        .select("name description createdAt")
        .skip(skip)
        .limit(limit)
        .lean();
    const totalMaterials = await materialModel.countDocuments(filter);

    res.status(200).json({
        message: "Materials retrieved successfully",
        materials,
        pagination: {
            currentPage: Number(page),
            totalPages: Math.ceil(totalMaterials / size),
            totalMaterials,
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

    const material = await materialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found.", { cause: 404 }));
    }

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

// Delete material (main_teacher only, and must be creator)
export const deleteMaterial = asyncHandler(async (req, res, next) => {
    const { materialId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(materialId)) {
        return next(new Error("Invalid Material ID.", { cause: 400 }));
    }
    
    
    const material = await materialModel.findById(materialId);
    if (!material) {
        return next(new Error("Material not found.", { cause: 404 }));
    }

  
    await material.deleteOne();

    res.status(200).json({ message: "Material deleted successfully" });
});