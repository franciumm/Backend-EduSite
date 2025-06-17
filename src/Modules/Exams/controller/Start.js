import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { GetObjectCommand ,PutObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { pagination } from "../../../utils/pagination.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { gradeModel} from "../../../../DB/models/grades.model.js";
import {examModel} from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { promises as fs } from 'fs';
import slugify from "slugify";

export const createExam = asyncHandler(async (req, res, next) => {
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
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || new Date() > end || start >= end) {
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
  // --- 1. INITIAL SETUP & VALIDATION ---
  const { examId, notes = "" } = req.body;
  const { user, isteacher } = req;
  const isTeacher = isteacher.teacher;
  const submissionTime = new Date(); // Use a single, consistent timestamp

  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("A valid Exam ID is required.", { cause: 400 }));
  }

  if (!req.file) {
    return next(new Error("Please upload a PDF file for submission.", { cause: 400 }));
  }

  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found.", { cause: 404 }));
  }

  // --- 2. AUTHORIZATION & TIMELINE LOGIC ---
  const studentId = user._id;

  // Find if the student has a special exception timeline
  const exceptionEntry = exam.exceptionStudents.find(
    (ex) => ex.studentId.toString() === studentId.toString()
  );

  // If the user is an exception student, they can submit anytime as per your rule.
  // Otherwise, we must check the timeline for both students and teachers.
  if (!exceptionEntry) {
    // For regular students, check if they are in an assigned group
    if (!isTeacher) {
      const student = user; // user object from isAuth middleware
      const isInGroup = exam.groupIds.some((gid) => gid.toString() === student.groupId?.toString());
      if (!isInGroup) {
        return next(new Error("You are not authorized to submit for this exam.", { cause: 403 }));
      }
    }
    
    // Check if the submission is within the allowed exam timeline for all non-exception users
    if (submissionTime < exam.startdate || submissionTime > exam.enddate) {
      return next(new Error("Exam submission is not within the allowed time frame.", { cause: 403 }));
    }
  }

  // --- 3. S3 FILE UPLOAD ---
  const s3Key = `ExamSubmissions/Submission_${examId}_${studentId}_${submissionTime.getTime()}.pdf`;

  try {
    const fileContent = fs.readFileSync(req.file.path);
    await uploadFileToS3(
      process.env.S3_BUCKET_NAME,
      s3Key,
      fileContent,
      "application/pdf"
    );
  } catch (err) {
    console.error("Failed to upload file to S3:", err);
    return next(new Error("File upload failed. Please try again.", { cause: 500 }));
  } finally {
    // Always clean up the local temporary file
    fs.unlinkSync(req.file.path);
  }


  // --- 4. DATABASE OPERATION WITH ROLLBACK ---
  try {
    // On re-submission, find the old entry to delete its S3 file
    const existingSubmission = await SubexamModel.findOne({ examId, studentId });

    if (existingSubmission?.fileKey) {
      // **FIXED BUG**: Delete the student's *previous submission*, not the exam paper.
      await deleteFileFromS3(process.env.S3_BUCKET_NAME, existingSubmission.fileKey);
    }

    // Atomically find and update (or create) the submission record
    const updatedSubmission = await SubexamModel.findOneAndUpdate(
      { examId, studentId }, // Query
      { // Data to update/insert
        SubmitDate: submissionTime,
        notes,
        fileBucket: process.env.S3_BUCKET_NAME,
        fileKey: s3Key,
        filePath: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      },
      { new: true, upsert: true } // Options: return the new doc, and create if it doesn't exist
    );

    // **REMOVED**: The unnecessary two-way binding. The code is now simpler and more efficient.
    // student.submittedexams.push(updatedSubmission._id);
    // await student.save();

    res.status(200).json({
      message: "Exam submitted successfully.",
      submission: updatedSubmission,
    });
  } catch (err) {
    // **NEW**: If the database fails, roll back by deleting the file just uploaded to S3
    console.error("Database error during submission. Rolling back S3 upload.", err);
    await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key);
    return next(new Error("Failed to save the submission. Please try again.", { cause: 500 }));
  }
});