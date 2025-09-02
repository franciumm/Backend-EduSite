// src/Modules/Exams/controller/Start.js

import { asyncHandler } from "../../../utils/erroHandling.js";
import { deleteFileFromS3 } from "../../../utils/S3Client.js"; // Only need delete for rollbacks
import { examModel } from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import slugify from "slugify";
import { toZonedTime } from 'date-fns-tz';
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";
import { synchronizeContentStreams } from "../../../utils/streamHelpers.js";

const propagateExamToStreams = async ({ exam, session }) => {
     await synchronizeContentStreams({
        content: exam,
        oldGroupIds: [], 
        newGroupIds: exam.groupIds,
        session
    });
    await contentStreamModel.updateOne(
        { userId: exam.createdBy, contentId: exam._id },
        { 
            $set: { contentType: 'exam' },
        },
        { upsert: true, session }
    );
};


export const createExam = asyncHandler(async (req, res, next) => {
    const examFile = req.files?.file?.[0];
    const answerFile = req.files?.answerFile?.[0];

    if (!examFile) {
        return next(new Error("The main exam file is required.", { cause: 400 }));
    }

    const newExam = await _internalCreateExam({
        ...req.validatedData,
        Name: req.validatedData.name, // Map validated name to the 'Name' field
        startdate: req.validatedData.startDate,
        enddate: req.validatedData.endDate,
        file: examFile, // Pass the multer-s3 file object
        teacherId: req.user._id,
        answerFile: answerFile, // Pass the optional multer-s3 file object
    });
    res.status(201).json({ message: "Exam created successfully", exam: newExam });
});

export const _internalCreateExam = async ({ Name, startdate, enddate, groupIds, file, teacherId, exceptionStudents, allowSubmissionsAfterDueDate, answerFile }) => {
    const slug = slugify(Name.trim(), { lower: true, strict: true });
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const examData = {
            Name, slug, startdate, enddate, groupIds,
            createdBy: teacherId, exceptionStudents,
            allowSubmissionsAfterDueDate: allowSubmissionsAfterDueDate || false,
            // Get S3 data from the multer-s3 file object
            bucketName: file.bucket,
            key: file.key,
            path: file.location, // The full S3 URL
        };

        if (answerFile) {
            examData.answerBucketName = answerFile.bucket;
            examData.answerKey = answerFile.key;
            examData.answerPath = answerFile.location;
        }
        
        const [newExam] = await examModel.create([examData], { session });
        await propagateExamToStreams({ exam: newExam, session });
        await session.commitTransaction();
        return newExam;

    } catch (error) {
        await session.abortTransaction();
        // S3 Rollback: If the DB transaction fails, delete files already uploaded by multer-s3.
        if (file) await deleteFileFromS3(file.bucket, file.key).catch(s3Err => console.error("S3 exam file rollback failed:", s3Err));
        if (answerFile) await deleteFileFromS3(answerFile.bucket, answerFile.key).catch(s3Err => console.error("S3 answer file rollback failed:", s3Err));
        throw error; 
    } finally {
        await session.endSession();
        // NO fs.unlink needed! The files never touched the server disk.
    }
};
export const submitExam = asyncHandler(async (req, res, next) => {
    const { examId, notes } = req.body; // No groupId from frontend
    const { user, isteacher } = req;

    if (isteacher) return next(new Error("Teachers are not permitted to submit exams.", { cause: 403 }));
    if (!req.file) return next(new Error("A file must be attached for submission.", { cause: 400 }));
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) return next(new Error("A valid Exam ID is required.", { cause: 400 }));

    const hasAccess = await canAccessContent({ user: user, isTeacher: isteacher, contentId: examId, contentType: 'exam' });
    if (!hasAccess) return next(new Error("You are not authorized to submit to this exam.", { cause: 403 }));

    const [exam, student] = await Promise.all([
        examModel.findById(examId).select('groupIds enddate exceptionStudents Name').lean(),
        studentModel.findById(user._id).select('groupIds').lean(),
    ]);

    if (!exam) { return next(new Error("Exam not found.", { cause: 404 })); }
    if (!student) { return next(new Error("Student not found.", { cause: 404 })); }
    
    // --- Unambiguous Context Resolution Logic ---
    const commonGroupIds = student.groupIds.filter(sgid => 
        exam.groupIds.some(egid => egid.equals(sgid))
    );

    if (commonGroupIds.length === 0) {
        return next(new Error("Submission context is invalid. You do not share a group with this exam.", { cause: 403 }));
    }
    if (commonGroupIds.length > 1) {
        return next(new Error("Ambiguous submission context: This exam exists in multiple groups you belong to. Please contact your teacher to resolve this.", { cause: 409 }));
    }
    const determinedGroupId = commonGroupIds[0]; // This is the one, unambiguous group
    // --- End of Logic ---

    const uaeTimeZone = 'Asia/Dubai';
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const exceptionEntry = exam.exceptionStudents.find(ex => ex.studentId.equals(user._id));
    const effectiveEndDate = exceptionEntry ? exceptionEntry.enddate : exam.enddate;
    const isLate = submissionTime > effectiveEndDate;

    if (isLate && !exam.allowSubmissionsAfterDueDate) {
        const reason = exceptionEntry ? "your special time window has closed" : "the submission deadline has passed";
        return next(new Error(`Cannot submit because ${reason}.`, { cause: 403 }));
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const currentVersionCount = await SubexamModel.countDocuments({ examId, studentId: user._id, groupId: determinedGroupId }).session(session);
        const newVersion = currentVersionCount + 1;
        const [newSubmission] = await SubexamModel.create([{
            examId,
            studentId: user._id,
            version: newVersion,
            examname: exam.Name,
            groupId: determinedGroupId, // Use the auto-detected group ID
            SubmitDate: submissionTime,
            notes: notes?.trim() || "",
            isLate: isLate,
            fileBucket: req.file.bucket,
            fileKey: req.file.key,
            filePath: req.file.location,
        }], { session });

        await submissionStatusModel.updateOne(
            { studentId: user._id, contentId: examId, groupId: determinedGroupId },
            { $set: { status: 'submitted', submissionId: newSubmission._id, isLate, SubmitDate: submissionTime, submissionModel: 'subexam' }},
            { session, upsert: true }
        );
        
        await session.commitTransaction();
        // NO CHANGE IN RESPONSE STRUCTURE
        res.status(200).json({ message: "Exam submitted successfully.", submission: newSubmission });

    } catch (error) {
        await session.abortTransaction();
        await deleteFileFromS3(req.file.bucket, req.file.key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
    }
});