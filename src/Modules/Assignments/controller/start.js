import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {SubassignmentModel}from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import {groupModel} from "../../../../DB/models/groups.model.js";
import mongoose from "mongoose";
import path from 'path'; // To handle file extensions
import { promises as fs } from 'fs';
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';


export const CreateAssignment = asyncHandler(async (req, res, next) => {

  const uaeTimeZone = 'Asia/Dubai';
  // ── 1) Perform all initial SYNCHRONOUS validations first (Fail-Fast) ──────
  if (!req.file) {
    return next(new Error("Please upload the assignment file.", { cause: 400 }));
  }

  const { name, startDate, endDate, gradeId } = req.body;
  const teacherId = req.user._id;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) ||toZonedTime(new Date(), uaeTimeZone) > end || start >= end) {
    await fs.unlink(req.file.path);
    return next(new Error("Invalid assignment timeline. Ensure dates are valid, the end date is in the future, and the start date is before the end date.", { cause: 400 }));
  }

  let raw = req.body.groupIds ?? req.body["groupIds[]"];
  if (!raw) { await fs.unlink(req.file.path); return next(new Error("Group IDs are required.", { cause: 400 })); }
  if (typeof raw === "string" && raw.trim().startsWith("[")) { try { raw = JSON.parse(raw); } catch {} }
  const groupIds = Array.isArray(raw) ? raw : [raw];
  if (groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) { await fs.unlink(req.file.path); return next(new Error("One or more Group IDs are invalid.", { cause: 400 })); }
  const validGroupIds = groupIds.map(id => new mongoose.Types.ObjectId(id));

  // ── 2) OPTIMIZATION: Execute independent I/O tasks in PARALLEL ─────────────
  let results;
  try {
    const [duplicate, groups, fileContent] = await Promise.all([
      assignmentModel.findOne({ name, groupIds: { $in: validGroupIds } }),
      groupModel.find({ _id: { $in: validGroupIds } }).select('gradeid'),
      fs.readFile(req.file.path)
    ]);
    results = { duplicate, groups, fileContent }; // Group results for the next step
  } catch (parallelError) {
    await fs.unlink(req.file.path);
    console.error("Error during parallel validation phase:", parallelError);
    return next(new Error("A server error occurred during validation.", { cause: 500 }));
  }

  // ── 3) Process results from the parallel phase ────────────────────────────
  const { duplicate, groups, fileContent } = results;

  if (duplicate) { await fs.unlink(req.file.path); return next(new Error("The Name already exists", { cause: 400 })); }
  if (groups.length !== validGroupIds.length) { await fs.unlink(req.file.path); return next(new Error("One or more group IDs were not found.", { cause: 404 })); }
  if (!groups.every(g => g.gradeid.toString() === gradeId)) { await fs.unlink(req.file.path); return next(new Error("One or more groups do not belong to the specified grade.", { cause: 400 })); }
  if (fileContent.length === 0) { await fs.unlink(req.file.path); return next(new Error("Cannot create an assignment with an empty file.", { cause: 400 })); }

  // ── 4) Begin SEQUENTIAL transaction: DB Create -> S3 Upload ───────────────
  const slug = slugify(name, { lower: true, strict: true });
  const s3Key = `assignments/${slug}-${Date.now()}.pdf`;

  const newAssignment = await assignmentModel.create({
    name, slug, startDate: start, endDate: end, gradeId,
    groupIds: validGroupIds,
    bucketName: process.env.S3_BUCKET_NAME,
    key: s3Key,
    path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
    createdBy: teacherId,
  });

  if (!newAssignment) { await fs.unlink(req.file.path); return next(new Error("Error while creating the assignment record in DB.", { cause: 500 })); }

  try {
    await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");
    res.status(201).json({ message: "Assignment created successfully", assignment: newAssignment });
  } catch (s3Error) {
    console.error("S3 Upload Failed. Rolling back database entry.", s3Error);
    await assignmentModel.findByIdAndDelete(newAssignment._id); // Rollback
    return next(new Error("Failed to upload file. The operation has been rolled back.", { cause: 500 }));
  } finally {
    await fs.unlink(req.file.path);
  }
});

export const submitAssignment = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Synchronous Input Validation ---
    const { assignmentId, notes } = req.body;
    const { _id: studentId, userName } = req.user;
    const uaeTimeZone = 'Asia/Dubai';
  
    if (!req.file) {
        return next(new Error("A file must be attached for submission.", { cause: 400 }));
    }
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        await fs.unlink(req.file.path).catch(e => console.error("Temp file cleanup failed on invalid input:", e));
        return next(new Error("A valid assignmentId is required.", { cause: 400 }));
    }

    // --- Phase 2: Maximum Performance - Parallel Asynchronous Validation ---
    let results, fileContent;
    try {
        const [assignment, student, oldSubmission] = await Promise.all([
            // Select all fields needed for the complex authorization logic
                
            assignmentModel.findById(assignmentId).select('startDate endDate groupIds enrolledStudents rejectedStudents name').lean(),
            studentModel.findById(studentId).select('groupId').lean(),
            SubassignmentModel.findOne({ studentId, assignmentId }).lean(),
        ]);
        fileContent = await fs.readFile(req.file.path);
        results = { assignment, student, oldSubmission };
    } catch (parallelError) {
        await fs.unlink(req.file.path).catch(e => console.error("Temp file cleanup failed:", e));
        return next(new Error("A server error occurred during validation.", { cause: 500 }));
    }

    // --- Phase 3: Process Results & Multi-Tiered Authorization Checks ---
    const { assignment, student, oldSubmission } = results;
      var now =  toZonedTime(new Date(), uaeTimeZone);
        const isLate = now > assignment.endDate;
    if (!student) { await fs.unlink(req.file.path); return next(new Error("Authenticated user is not a valid student.", { cause: 200 })); }
    if (!assignment) { await fs.unlink(req.file.path); return next(new Error("Assignment not found.", { cause: 404 })); }
    if (fileContent.length === 0) { await fs.unlink(req.file.path); return next(new Error("Cannot submit an empty file.", { cause: 400 })); }

    // Authorization Logic with "Enrolled" Override
    const isRejected = assignment.rejectedStudents?.some(id => id.equals(studentId));
    const isEnrolled = assignment.enrolledStudents?.some(id => id.equals(studentId));
    const isInGroup = assignment.groupIds.some(gid => gid.equals(student.groupId));
    
    // Rule 1: Highest priority - check for rejection.
    if (isRejected) {
        await fs.unlink(req.file.path);
        return next(new Error("You are explicitly blocked from submitting this assignment.", { cause: 200 }));
    }

    // Rule 2: If explicitly enrolled, they have permission. Bypass other checks.
    if (!isEnrolled) {
        // Rule 3: If not enrolled, they must be in an authorized group.
        if (!isInGroup) {
            await fs.unlink(req.file.path);
            return next(new Error("You are not in an authorized group for this assignment.", { cause: 200 }));
        }

        // Rule 4: If in a group, they must adhere to the main timeline.
      

        if (now < assignment.startDate) {
            await fs.unlink(req.file.path);
            return next(new Error("The submission window for your group is closed.", { cause: 200 }));
        }
    }
    // If we reach here, the student is either enrolled OR in a group within the timeline. Access is granted.
    if (isLate) {
    // If it's late, check if late submissions are disallowed.
    if (assignment.allowSubmissionsAfterDueDate==false) {
        await fs.unlink(req.file.path);
        return next(new Error("The submission window for your group is closed.", { cause: 200 }));
    }
}
    // --- Phase 4: Prepare & Commit - Staging S3 and Atomic DB Write ---
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const fileExtension = path.extname(req.file.originalname);
    const s3Key = `AssignmentSubmissions/${assignmentId}/${studentId}_${submissionTime.getTime()}${fileExtension}`;
    let newSubmission;

    try {
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");

        newSubmission = await SubassignmentModel.findOneAndUpdate(
            { studentId, assignmentId },
            {
              
                assignmentname : assignment.name,
                groupId: student.groupId,
                SubmitDate: submissionTime,
                notes: notes?.trim() || (isLate ? "Late submission" : "Submitted on time"),
                isLate,
                bucketName: process.env.S3_BUCKET_NAME,
                key: s3Key,
                path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            },
            { new: true, upsert: true, lean: true }
        );

    } catch (error) {
        console.error("Database error during submission. Rolling back S3 upload.", error);
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await fs.unlink(req.file.path).catch(e => console.error("Final temp file cleanup failed:", e));
    }

    // --- Phase 5: Post-Commit Cleanup of Old S3 File ---
    if (oldSubmission?.key && oldSubmission.key !== s3Key) {
        deleteFileFromS3(process.env.S3_BUCKET_NAME, oldSubmission.key)
            .catch(err => console.error("Non-critical error: Failed to delete old S3 file on resubmission:", err));
    }

    res.status(200).json({
        message: oldSubmission ? "Assignment re-submitted successfully." : "Assignment submitted successfully.",
        submission: newSubmission,
    });
});