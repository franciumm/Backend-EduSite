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
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";



const propagateAssignmentToStreams = async ({ assignment, session }) => {
    // 1. Get students from groups
    const studentsFromGroups = await studentModel.find({ groupId: { $in: assignment.groupIds } }).select('_id groupId').session(session);

    // 2. Combine with directly enrolled students, ensuring uniqueness
    const studentMap = new Map();
    studentsFromGroups.forEach(s => studentMap.set(s._id.toString(), { userId: s._id, groupId: s.groupId }));
    (assignment.enrolledStudents || []).forEach(studentId => {
        if (!studentMap.has(studentId.toString())) {
            // A directly enrolled student might not have a groupId relevant to this assignment
            studentMap.set(studentId.toString(), { userId: studentId, groupId: null });
        }
    });

    const allStudents = Array.from(studentMap.values());
    if (allStudents.length === 0 && !assignment.createdBy) return;

    // 3. Create Stream Entries for ALL students + the teacher
    const streamEntries = allStudents.map(s => ({
        userId: s.userId,
        contentId: assignment._id,
        contentType: 'assignment',
        groupId: s.groupId // This can correctly be null for directly enrolled students
    }));
    streamEntries.push({
        userId: assignment.createdBy,
        contentId: assignment._id,
        contentType: 'assignment',
    });

    // 4. Create Status Entries for ALL students, using the correct 'allStudents' list
    const statusEntries = allStudents.map(s => ({
        studentId: s.userId,
        contentId: assignment._id,
        contentType: 'assignment',
        submissionModel: 'subassignment',
        // The groupId from the map is the correct context for the status entry
        groupId: s.groupId,
        status: 'assigned'
    }));

    // 5. Insert into database
    await Promise.all([
        contentStreamModel.insertMany(streamEntries, { session }),
        statusEntries.length > 0 ? submissionStatusModel.insertMany(statusEntries, { session }) : Promise.resolve()
    ]);
};
export const _internalCreateAssignment = async ({ name, startDate, endDate, groupIds, file, teacherId, allowSubmissionsAfterDueDate ,answerFile}) => {
        const slug = slugify(name, { lower: true, strict: true });

    const s3Key = `assignments/${slugify(name, { lower: true, strict: true })}-${Date.now()}${path.extname(file.originalname)}`;
        const s3AnswerKey = answerFile ? `assignments/answers/${slug}-answer-${Date.now()}${path.extname(answerFile.originalname)}` : null;
    const session = await mongoose.startSession();

    try {
                session.startTransaction();

        const fileContent = await fs.readFile(file.path);
        if (fileContent.length === 0) throw new Error("Cannot create an assignment with an empty file.");
   const assignmentData = {
            name,
            slug,
            startDate,
            endDate,
            groupIds,
            allowSubmissionsAfterDueDate: allowSubmissionsAfterDueDate || false,
            bucketName: process.env.S3_BUCKET_NAME,
            key: s3Key,
            path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            createdBy: teacherId,
        };

          let answerFileContent = null;
        if (answerFile && s3AnswerKey) {
            answerFileContent = await fs.readFile(answerFile.path);
            if (answerFileContent.length === 0) throw new Error("The answer file cannot be empty.");
            assignmentData.answerBucketName = process.env.S3_BUCKET_NAME;
            assignmentData.answerKey = s3AnswerKey;
            assignmentData.answerPath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3AnswerKey}`;
        }
        
        const [newAssignment] = await assignmentModel.create([assignmentData], { session });
  await propagateAssignmentToStreams({ assignment: newAssignment, session });
        // 1. Upload to S3 first. If this fails, the DB is not touched.
  await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, file.mimetype);
        if (answerFile && s3AnswerKey && answerFileContent) {
            await uploadFileToS3(process.env.S3_BUCKET_NAME, s3AnswerKey, answerFileContent, answerFile.mimetype);
        }

        await session.commitTransaction();
        return newAssignment;

     


    } catch (err) {
        await session.abortTransaction();
        console.error("Internal assignment creation failed. Rolling back S3 files...", err);
        // If any error occurred, attempt to clean up the S3 files.
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 assignment file rollback failed:", e));
        if (s3AnswerKey) {
            await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3AnswerKey).catch(e => console.error("S3 answer file rollback failed:", e));
        }
        throw err; // Re-throw the error for the calling service (hub or controller) to handle.
    } finally {
         await session.endSession();
        if (file?.path) {
            await fs.unlink(file.path).catch(e => console.error(`Failed to delete temp file: ${file.path}`, e));
        }
        if (answerFile?.path) {
            await fs.unlink(answerFile.path).catch(e => console.error(`Failed to delete temp file: ${answerFile.path}`, e));
        }
    }
};

export const CreateAssignment = asyncHandler(async (req, res, next) => {
      const assignmentFile = req.files?.file?.[0];
    const answerFile = req.files?.answerFile?.[0];

    if (!assignmentFile) {
        if (answerFile?.path) await fs.unlink(answerFile.path);
        return next(new Error("The main assignment file is required.", { cause: 400 }));
    }

    const newAssignment = await _internalCreateAssignment({
        ...req.validatedData,
        file: assignmentFile,
        teacherId: req.user._id,       
         answerFile: answerFile, // Pass the optional answer file

    });
    res.status(201).json({ message: "Assignment created successfully", assignment: newAssignment });
});


export const submitAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId, notes } = req.body;
    const { user,isteacher  } = req;

    if (!req.file) {
        return next(new Error("A file must be attached for submission.", { cause: 400 }));
    }
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        await fs.unlink(req.file.path);
        return next(new Error("A valid assignmentId is required.", { cause: 400 }));
    }

    // --- REFACTOR: Use the universal authorizer to check permissions ---
      const hasAccess = await canAccessContent({
        user,
        isTeacher: isteacher,
        contentId: assignmentId,
        contentType: 'assignment'
    });

    if (!hasAccess) {
        await fs.unlink(req.file.path);
        return next(new Error("You are not authorized to submit to this assignment.", { cause: 403 }));
    }
    // --- END REFACTOR ---

    const [assignment, student, fileContent] = await Promise.all([
        assignmentModel.findById(assignmentId),
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
 await submissionStatusModel.updateOne(
            { studentId: user._id, contentId: assignmentId, contentType: 'assignment' },
            { 
                $set: {
                    status: 'submitted', 
                    submissionId: newSubmission._id,
                    isLate: isLate,
                    SubmitDate: submissionTime,
                    // Ensure the groupId is set, especially if this is a new document
                    groupId: newSubmission.groupId, 
                    submissionModel: 'subassignment'
                }
            },
            { session, upsert: true } // The magic is here: upsert: true
        );

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