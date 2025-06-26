import path from 'path';
import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import mongoose from "mongoose";
import { promises as fs } from 'fs';
import { toZonedTime } from 'date-fns-tz';
import { canAccessContent } from '../../../middelwares/contentAuth.js';



export const _internalCreateAssignment = async ({ name, startDate, endDate, gradeId, groupIds, file, teacherId, allowSubmissionsAfterDueDate }) => {
    const s3Key = `assignments/${slugify(name, { lower: true, strict: true })}-${Date.now()}${path.extname(file.originalname)}`;
    
    try {
        const fileContent = await fs.readFile(file.path);
        if (fileContent.length === 0) throw new Error("Cannot create an assignment with an empty file.");

        // 1. Upload to S3 first. If this fails, the DB is not touched.
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, file.mimetype);

        // 2. Create the database record.
        const newAssignment = await assignmentModel.create({
            name,
            slug: slugify(name, { lower: true, strict: true }),
            startDate,
            endDate,
            gradeId,
            groupIds,
            allowSubmissionsAfterDueDate: allowSubmissionsAfterDueDate || false,
            bucketName: process.env.S3_BUCKET_NAME,
            key: s3Key,
            path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            createdBy: teacherId,
        });

        return newAssignment;

    } catch (err) {
        console.error("Internal assignment creation failed. Rolling back S3 file...", err);
        // If any error occurred, attempt to clean up the S3 file.
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 rollback failed:", e));
        throw err; // Re-throw the error for the calling service (hub or controller) to handle.
    } finally {
        // Always clean up the local temp file.
        if (file?.path) {
            await fs.unlink(file.path).catch(e => console.error(`Failed to delete temp file: ${file.path}`, e));
        }
    }
};

export const CreateAssignment = asyncHandler(async (req, res, next) => {
    if (!req.file) {
        return next(new Error("Please upload the assignment file.", { cause: 400 }));
    }

    const { name, startDate, endDate, gradeId, groupIds, allowSubmissionsAfterDueDate } = req.body;
    
    // Perform necessary validation before calling the internal function
    if (!name || !startDate || !endDate || !gradeId || !groupIds) {
        return next(new Error("Missing required fields: name, startDate, endDate, gradeId, and groupIds are all required.", { cause: 400 }));
    }

    const newAssignment = await _internalCreateAssignment({
        ...req.body,
        file: req.file,
        teacherId: req.user._id,
    });

    res.status(201).json({ message: "Assignment created successfully", assignment: newAssignment });
});



// =================================================================
// --- PHASE 2, FIX 2.2: Refactored submitAssignment Controller ---
// =================================================================
export const submitAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId, notes } = req.body;
    const { user } = req;

    if (!req.file) {
        return next(new Error("A file must be attached for submission.", { cause: 400 }));
    }
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        await fs.unlink(req.file.path);
        return next(new Error("A valid assignmentId is required.", { cause: 400 }));
    }

    // --- REFACTOR: Use the universal authorizer to check permissions ---
    const hasAccess = await canAccessContent({
        user: { _id: user._id, isTeacher: req.isteacher.teacher, groupId: user.groupId },
        contentId: assignmentId,
        isTeacher: req.isteacher.teacher, 
        contentType: 'assignment'
    });

    if (!hasAccess) {
        await fs.unlink(req.file.path);
        return next(new Error("You are not authorized to submit to this assignment.", { cause: 403 }));
    }
    // --- END REFACTOR ---

    const [assignment, student, fileContent] = await Promise.all([
        assignmentModel.findById(assignmentId).lean(),
        studentModel.findById(user._id).select('groupId').lean(),
        fs.readFile(req.file.path)
    ]);
    
    if (!assignment) { await fs.unlink(req.file.path); return next(new Error("Assignment not found.", { cause: 404 })); }
    if (fileContent.length === 0) { await fs.unlink(req.file.path); return next(new Error("Cannot submit an empty file.", { cause: 400 })); }
    
    const uaeTimeZone = 'Asia/Dubai';
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const isLate = submissionTime > new Date(assignment.endDate);

    if (isLate && !assignment.allowSubmissionsAfterDueDate) {
        await fs.unlink(req.file.path);
        return next(new Error("Cannot submit because the deadline has passed.", { cause: 403 }));
    }

    const fileExtension = path.extname(req.file.originalname);
    const s3Key = `AssignmentSubmissions/${assignmentId}/${user._id}_${submissionTime.getTime()}${fileExtension}`;
    
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const currentVersionCount = await SubassignmentModel.countDocuments({ studentId: user._id, assignmentId }).session(session);
        const newVersion = currentVersionCount + 1;
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, req.file.mimetype);

        const [newSubmission] = await SubassignmentModel.create([{
            studentId: user._id, assignmentId, version: newVersion,
            assignmentname: assignment.name, groupId: student.groupId,
            SubmitDate: submissionTime,
            notes: notes?.trim() || (isLate ? "Submitted late" : "Submitted on time"),
            isLate, bucketName: process.env.S3_BUCKET_NAME, key: s3Key,
            path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
        }], { session });

        await session.commitTransaction();
        res.status(200).json({ message: "Assignment submitted successfully.", submission: newSubmission });

    } catch (error) {
        await session.abortTransaction();
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
        await fs.unlink(req.file.path).catch(e => console.error(`Final temp file cleanup failed: ${req.file.path}`, e));
    }
});