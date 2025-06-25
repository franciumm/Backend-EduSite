import { asyncHandler } from "../../../utils/erroHandling.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { gradeModel} from "../../../../DB/models/grades.model.js";
import {examModel} from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { promises as fs } from 'fs';
import slugify from "slugify";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';

export const createExam = asyncHandler(async (req, res, next) => {
      const uaeTimeZone = 'Asia/Dubai';

    // --- Phase 1: Fail Fast - Synchronous Input Validation & Sanitization ---
    if (!req.file) {
        return next(new Error("The exam file must be uploaded.", { cause: 400 }));
    }

    const { Name, startdate, enddate, gradeId } = req.body;
    const name = Name?.trim(); // Sanitize name to prevent whitespace issues
    const teacherId = req.user._id;

    if (!name || !startdate || !enddate || !gradeId) {
        await fs.unlink(req.file.path);
        return next(new Error("Name, startdate, enddate, and gradeId are required.", { cause: 400 }));
    }

    // Comprehensive Date Validation
    const start = new Date(startdate);
    const end = new Date(enddate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) ||toZonedTime(new Date(), uaeTimeZone) > end || start >= end) {
        await fs.unlink(req.file.path);
        return next(new Error("Invalid exam timeline. Ensure dates are valid, end date is in the future, and start date is before end date.", { cause: 400 }));
    }

    // Robust parsing for groupIds and exceptionStudents from form-data
    const parseJsonInput = (input) => {
        if (!input) return [];
        if (Array.isArray(input)) return input;
        if (typeof input === "string") {
            try { return JSON.parse(input); } catch { return [input]; }
        }
        return [input];
    };
    
    const groupIds = parseJsonInput(req.body.groupIds ?? req.body["groupIds[]"]);
    const exceptionStudentsInput = parseJsonInput(req.body.exceptionStudents);

    if (groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
        await fs.unlink(req.file.path);
        return next(new Error("One or more Group IDs are invalid.", { cause: 400 }));
    }
    const validGroupIds = groupIds.map(id => new mongoose.Types.ObjectId(id));
    const exceptionStudentIds = exceptionStudentsInput.map(ex => ex?.studentId).filter(id => id && mongoose.Types.ObjectId.isValid(id));

    // --- Phase 2: Maximum Performance - Parallel Asynchronous Validation ---
    let results;
    try {
        // Run all independent read operations concurrently
        const [grade, groups, duplicateExam, exceptionStudents, fileContent] = await Promise.all([
            gradeModel.findById(gradeId).lean(),
            groupModel.find({ _id: { $in: validGroupIds } }).lean(),
            examModel.findOne({ Name: name, groupIds: { $in: validGroupIds } }).lean(),
            studentModel.find({ _id: { $in: exceptionStudentIds } }).select('groupId').lean(),
            fs.readFile(req.file.path) // Read file from disk while querying DB
        ]);
        results = { grade, groups, duplicateExam, exceptionStudents, fileContent };
    } catch (parallelError) {
        await fs.unlink(req.file.path); // Cleanup on failure
        console.error("Error during parallel validation phase:", parallelError);
        return next(new Error("A server error occurred during validation.", { cause: 500 }));
    }
    
    // --- Phase 3: Process Parallel Results & Deep Coherency Validation ---
    const { grade, groups, duplicateExam, exceptionStudents, fileContent } = results;

    if (!grade) { await fs.unlink(req.file.path); return next(new Error("The specified grade does not exist.", { cause: 404 })); }
    if (duplicateExam) { await fs.unlink(req.file.path); return next(new Error("An exam with this name already exists for one of the selected groups.", { cause: 409 })); }
    if (groups.length !== validGroupIds.length) { await fs.unlink(req.file.path); return next(new Error("One or more specified groups were not found.", { cause: 404 })); }
    if (fileContent.length === 0) { await fs.unlink(req.file.path); return next(new Error("Cannot create an exam with an empty file.", { cause: 400 })); }
    
    // Deeper Validation: Ensure relationships between data are logical
    if (!groups.every(g => g.gradeid.equals(grade._id))) {
        await fs.unlink(req.file.path);
        return next(new Error("Data mismatch: One or more groups do not belong to the specified grade.", { cause: 400 }));
    }
    if (exceptionStudentIds.length !== exceptionStudents.length) {
        await fs.unlink(req.file.path);
        return next(new Error("Data mismatch: One or more student IDs in the exception list were not found.", { cause: 404 }));
    }
    const validGroupIdsStr = validGroupIds.map(id => id.toString());
    if (!exceptionStudents.every(s => s.groupId && validGroupIdsStr.includes(s.groupId.toString()))) {
        await fs.unlink(req.file.path);
        return next(new Error("Data mismatch: An exception student does not belong to any of the target groups for this exam.", { cause: 400 }));
    }
    const formattedExceptions = exceptionStudentsInput.map(ex => ({ // Format after validation
        studentId: new mongoose.Types.ObjectId(ex.studentId),
        startdate: new Date(ex.startdate),
        enddate: new Date(ex.enddate),
    }));

    // --- Phase 4: Transactional Write Operation for Supreme Data Integrity ---
    const slug = slugify(name, { lower: true, strict: true });
    const s3Key = `exams/${slug}-${Date.now()}.pdf`;
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const [newExam] = await examModel.create([{
            Name: name,
            slug,
            startdate: start,
            enddate: end,
            grade: gradeId,
            groupIds: validGroupIds,
            bucketName: process.env.S3_BUCKET_NAME,
            key: s3Key,
            path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            createdBy: teacherId,
            exceptionStudents: formattedExceptions,
        }], { session });

        // Only upload to S3 if DB create succeeds
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");

        // If both succeed, commit the transaction
        await session.commitTransaction();
        res.status(201).json({ message: "Exam created successfully", exam: newExam });

    } catch (error) {
        // If any error occurs, abort the entire transaction
        await session.abortTransaction();
        // If the S3 upload failed, the DB record is gone. If the DB failed, S3 wasn't touched.
        // But if DB succeeded and S3 failed, the file might exist in S3, so we try to clean it up.
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(s3Err => console.error("Attempted to cleanup S3 file after transaction abort but failed:", s3Err));
        console.error("Error creating exam, transaction aborted:", error);
        return next(new Error("Failed to create exam due to a server error. The operation was rolled back.", { cause: 500 }));
    } finally {
        // ALWAYS end the session and cleanup the local file
        await session.endSession();
        await fs.unlink(req.file.path); 
    }
});

export const submitExam = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Synchronous Input Validation & Authorization ---
    const { examId, notes } = req.body;
    const { user, isteacher } = req; 
    const uaeTimeZone = 'Asia/Dubai';
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const studentId = user._id;

    if (isteacher?.teacher === true) {
        return next(new Error("Teachers are not permitted to submit exams.", { cause: 200 }));
    }
    if (!req.file) {
        return next(new Error("A file must be attached for submission.", { cause: 400 }));
    }
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        await fs.unlink(req.file.path).catch(e => console.error("Temp file cleanup failed on invalid input:", e));
        return next(new Error("A valid Exam ID is required.", { cause: 400 }));
    }
   
    // --- Phase 2: Maximum Performance - Asynchronous Validation ---
    let exam, fileContent;
    try {
        // Fetch both exam details and file content from disk concurrently
        [exam, fileContent] = await Promise.all([
            examModel.findById(examId).lean(),
            fs.readFile(req.file.path)
        ]);
    } catch (parallelError) {
        await fs.unlink(req.file.path).catch(e => console.error("Temp file cleanup failed:", e));
        return next(new Error("A server error occurred during validation.", { cause: 500 }));
    }

    // --- Phase 3: Process Results & Deep Authorization Checks ---
    if (!exam) { 
        await fs.unlink(req.file.path); 
        return next(new Error("Exam not found.", { cause: 404 })); 
    }
    if (fileContent.length === 0) { 
        await fs.unlink(req.file.path); 
        return next(new Error("Cannot submit an empty file.", { cause: 400 })); 
    }

    let effectiveStartDate, effectiveEndDate;
    const exceptionEntry = exam.exceptionStudents.find(ex => ex.studentId.equals(studentId));
    
    if (exceptionEntry) {
        effectiveStartDate = exceptionEntry.startdate;
        effectiveEndDate = exceptionEntry.enddate;
    } else { // Standard validation for non-exception students
        if (exam.rejectedStudents?.some(id => id.equals(studentId))) {
            await fs.unlink(req.file.path);
            return next(new Error("You are explicitly blocked from submitting for this exam.", { cause: 200 }));
        }
        if (!exam.groupIds.some(gid => gid.equals(user.groupId))) {
            await fs.unlink(req.file.path);
            return next(new Error("You are not in an authorized group for this exam.", { cause: 200 }));
        }
        effectiveStartDate = exam.startdate;
        effectiveEndDate = exam.enddate;
    }

    const isLate = submissionTime > effectiveEndDate;

    if (isLate && !exam.allowSubmissionsAfterDueDate) {
        await fs.unlink(req.file.path);
        const errorMessage = exceptionEntry ? "Submission is outside your special allowed time frame." : "Exam submission window is closed.";
        return next(new Error(errorMessage, { cause: 200 }));
    }

    // --- Phase 4: Transactional Write Operation for Supreme Data Integrity ---
    const s3Key = `ExamSubmissions/${examId}/${studentId}_${submissionTime.getTime()}.pdf`;
    const session = await mongoose.startSession();
    let newSubmission;

    try {
        session.startTransaction();
        
        // **FIX 1: Atomically calculate the new version number within the transaction.**
        const currentVersionCount = await SubexamModel.countDocuments({ examId, studentId }).session(session);
        const newVersion = currentVersionCount + 1;

        // Upload to S3 first. If it fails, we haven't touched the DB yet.
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");

        // **FIX 2: Use the correct syntax for .create() and include all required fields.**
        const submissionDocs = await SubexamModel.create(
           [{
                examId, // Added
                studentId, // Added
                version: newVersion, // Added
                examname: exam.Name,
                SubmitDate: submissionTime,
                notes: notes?.trim() || "",
                fileBucket: process.env.S3_BUCKET_NAME,
                fileKey: s3Key,
                filePath: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
                isLate: isLate
           }],
           // **FIX 3: Provide only the session option to .create().**
           { session } 
        );

        newSubmission = submissionDocs[0]; // .create returns an array

        await session.commitTransaction();

    } catch (error) {
        await session.abortTransaction();
        console.error("Error submitting exam, transaction aborted. Rolling back S3 upload.", error);
        // Attempt to clean up the S3 file if the DB operation failed after upload
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
        // Always clean up the local temp file
        await fs.unlink(req.file.path).catch(e => console.error("Final temp file cleanup failed:", e));
    }

    // **FIX 4: Remove the logic for cleaning up old S3 files. We want to keep all versions.**

    res.status(200).json({
        message: `Exam submitted successfully (Version ${newSubmission.version}).`,
        submission: newSubmission,
    });
});