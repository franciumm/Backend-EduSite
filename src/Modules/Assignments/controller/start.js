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


export const CreateAssignment = asyncHandler(async (req, res, next) => {
  // ── 1) Perform all initial SYNCHRONOUS validations first (Fail-Fast) ──────
  if (!req.file) {
    return next(new Error("Please upload the assignment file.", { cause: 400 }));
  }

  const { name, startDate, endDate, gradeId } = req.body;
  const teacherId = req.user._id;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || new Date() > end || start >= end) {
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
  const { assignmentId, notes } = req.body;
  const file = req.file;
  const { _id: userId, userName } = req.user;

  // 1. Fail Fast: Validate all inputs before proceeding
  if (!file) {
    return next(new Error("A file must be attached for submission.", { cause: 400 }));
  }
  if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
    await fs.unlink(file.path); // Cleanup file if input is bad
    return next(new Error("A valid assignmentId is required.", { cause: 400 }));
  }

  // 2. Use a Database Transaction for All-or-Nothing Integrity
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // 3. Perform all validation and business logic inside the transaction
    const [assignment, student, existingSubmission] = await Promise.all([
      assignmentModel.findById(assignmentId).session(session),
      studentModel.findById(userId).select('groupId submittedassignments').session(session),
      SubassignmentModel.findOne({ studentId: userId, assignmentId }).session(session)
    ]);

    // Validation checks
    if (!student) {
      // This is our primary security check. If the user isn't a student, they can't proceed.
      return next(new Error("Authenticated user is not a valid student.", { cause: 403 }));
    }
    if (!assignment) {
      return next(new Error("Assignment not found.", { cause: 404 }));
    }
    if (existingSubmission) {
      return next(new Error("You have already submitted this assignment.", { cause: 409 })); // 409 Conflict
    }

    // Business logic checks
    if (assignment.rejectedStudents?.some(id => id.equals(userId))) {
      return next(new Error("You are blocked from submitting this assignment.", { cause: 403 }));
    }
    if (!assignment.groupIds.some(gid => gid.equals(student.groupId))) {
      return next(new Error("You are not in the correct group for this assignment.", { cause: 403 }));
    }
    const now = new Date();
    if (now < assignment.startDate) {
      return next(new Error("The submission window has not yet opened.", { cause: 403 }));
    }
    const isLate = now > assignment.endDate;

    // 4. S3 Upload (occurs only if all validations pass)
    const fileExtension = path.extname(file.originalname);
    const fileName = `${assignment.name}_${userName}_${Date.now()}${fileExtension}`;
    const key = `Submissions/${assignmentId}/${userId}/${fileName}`;

    // Read file content using the promise-based fs module provided in imports.
    // This is memory-safe for typical document sizes and avoids import conflicts.
    const fileContent = await fs.readFile(file.path);

    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: file.mimetype,
    }));

    // 5. Create and update database records *within the transaction*
    const submissionDate = new Date();
    const [submission] = await SubassignmentModel.create([{
      studentId: userId,
      assignmentId,
      bucketName: process.env.S3_BUCKET_NAME,
      groupId: student.groupId,
      key,
      SubmitDate: submissionDate,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      isLate,
      notes: notes || (isLate ? "Late submission" : "Submitted on time"),
    }], { session });

    student.submittedassignments.addToSet(submission._id); // Use the new submission ID
    await student.save({ session });

    // If all operations succeed, commit the transaction
    await session.commitTransaction();

    res.status(201).json({ // Use 201 Created for a new resource
      message: "Assignment submitted successfully",
      data: submission,
    });

  } catch (err) {
    // If any error occurs (DB or S3), abort the transaction to roll back all DB changes
    await session.abortTransaction();
    console.error("Error in submitAssignment, transaction rolled back:", err);
    return next(new Error("Failed to submit the assignment due to a server error.", { cause: 500 }));
  } finally {
    // This block ALWAYS runs, ensuring the temp file is deleted and the session ends
    await session.endSession();
    await fs.unlink(file.path).catch(unlinkErr => console.error(`Failed to delete temp file: ${file.path}`, unlinkErr));
  }
});