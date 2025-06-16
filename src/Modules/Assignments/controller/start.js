import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {SubassignmentModel}from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import {groupModel} from "../../../../DB/models/groups.model.js";
import fs from "fs";
import mongoose from "mongoose";
import path from 'path'; // To handle file extensions
import { promises as fs } from 'fs';


export const CreateAssignment = asyncHandler(async (req, res, next) => {
  console.log("--- [DEBUG] CreateAssignment request started ---");
  console.log("[DEBUG 1] Initial request body:", req.body);
  console.log("[DEBUG 2] Multer file object:", req.file); // VERY IMPORTANT LOG

  // ── 1) File must be present before any other operation ─────────────────────
  if (!req.file) {
    console.error("[FATAL] Step 2 Failed: req.file is missing.");
    return next(new Error("Please upload the assignment file.", { cause: 400 }));
  }

  const teacherId = req.user._id;
  const { name, startDate, endDate, gradeId } = req.body;
  
  // ... (groupId parsing logic remains the same)
  let raw = req.body.groupIds ?? req.body["groupIds[]"];
  if (!raw) {
    await fs.unlink(req.file.path);
    return next(new Error("Group IDs are required.", { cause: 400 }));
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { raw = JSON.parse(raw); } catch {}
  }
  const groupIds = Array.isArray(raw) ? raw : [raw];
  if (groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
    await fs.unlink(req.file.path);
    return next(new Error("One or more Group IDs are invalid.", { cause: 400 }));
  }
  const validGroupIds = groupIds.map(id => new mongoose.Types.ObjectId(id));
  console.log("[DEBUG 3] Validated Group IDs:", validGroupIds);


  // ... (Database validation logic remains the same)
  const duplicate = await assignmentModel.findOne({ name, groupIds: { $in: validGroupIds } });
  if (duplicate) { /* ... error handling ... */ }
  const groups = await groupModel.find({ _id: { $in: validGroupIds } }).select('gradeid');
  if (groups.length !== validGroupIds.length) { /* ... error handling ... */ }
  const allGroupsInGrade = groups.every(g => g.gradeid.toString() === gradeId);
  if (!allGroupsInGrade) { /* ... error handling ... */ }


  // ── 5) REVISED LOGIC: Create DB record FIRST ───────────────────────────────
  const slug = slugify(name, { lower: true, strict: true });
  const s3Key = `assignments/${slug}-${Date.now()}.pdf`;
  console.log("[DEBUG 4] Generated S3 Key:", s3Key);

  const newAssignment = await assignmentModel.create({
    name, slug, startDate, endDate, gradeId,
    groupIds: validGroupIds,
    bucketName: process.env.S3_BUCKET_NAME,
    key: s3Key,
    path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
    createdBy: teacherId,
  });

  if (!newAssignment) {
      await fs.unlink(req.file.path);
      return next(new Error("Error while creating the assignment record in DB.", { cause: 500 }));
  }
  console.log("[DEBUG 5] Database record created successfully. ID:", newAssignment._id);

  // ── 6) PREPARE FOR S3 UPLOAD - THE CRITICAL PART ───────────────────────────
  let fileContent;
  try {
    console.log(`[DEBUG 6] Reading file from path: ${req.file.path}`);
    fileContent = await fs.readFile(req.file.path);
    console.log(`[DEBUG 7] File read successfully. File size: ${fileContent.length} bytes.`);
    
    if (fileContent.length === 0) {
        console.error("[FATAL] Step 7 Failed: File is empty (0 bytes).");
        // We must manually trigger the rollback
        throw new Error("Cannot upload an empty file."); 
    }

  } catch (readError) {
    console.error("[FATAL] Step 6/7 Failed: Could not read the file from disk.", readError);
    await assignmentModel.findByIdAndDelete(newAssignment._id);
    return next(new Error("Server failed to read the uploaded file.", { cause: 500 }));
  }

  // ── 7) Upload to S3 AFTER DB record is secure ──────────────────────────────
  try {
    console.log("--- [DEBUG] Calling uploadFileToS3 with these parameters: ---");
    console.log("  > bucketName:", process.env.S3_BUCKET_NAME);
    console.log("  > key:", s3Key);
    console.log("  > body (type):", typeof fileContent);
    console.log("  > contentType:", "application/pdf");
    console.log("----------------------------------------------------------");
    
    // The actual call
    await uploadFileToS3(
      process.env.S3_BUCKET_NAME,
      s3Key,
      fileContent, // The file buffer from fs.readFile
      "application/pdf"
    );

    console.log("[SUCCESS] S3 upload completed.");
    res.status(201).json({
      message: "Assignment created successfully",
      assignment: newAssignment
    });

  } catch (err) {
    // This will now log the REAL error from AWS
    console.error("[FATAL] S3 Upload Failed. Rolling back database entry.", err); 
    await assignmentModel.findByIdAndDelete(newAssignment._id);
    return next(new Error("Failed to upload file. The operation has been rolled back.", { cause: 500 }));
  } finally {
    console.log(`[DEBUG] Cleaning up local file: ${req.file.path}`);
    await fs.unlink(req.file.path);
  }
});

export const submitAssignment = asyncHandler(async (req, res, next) => {
  const { assignmentId, notes } = req.body;
  const file = req.file;
  const { _id: userId, userName } = req.user;

  // FIX 1: A file must be attached. If not, we don't need to proceed.
  if (!file) {
    return next(new Error("Please attach a file under the field name `file`", { cause: 400 }));
  }

  // FIX 2: Use a try...finally block to GUARANTEE temporary file cleanup, preventing resource leaks.
  try {
    // FIX 3: Explicitly check the user's role. Block non-students immediately.
    // This is clearer and fails faster.
    if (req.isteacher?.teacher === true) {
        return next(new Error("Teachers are not permitted to submit assignments.", { cause: 403 }));
    }

    // FIX 4: Validate required input from req.body.
    if (!assignmentId) {
        return next(new Error("Required field `assignmentId` is missing.", { cause: 400 }));
    }
    
    // --- Database Queries and Validation ---
    const [assignment, student] = await Promise.all([
        assignmentModel.findById(assignmentId),
        studentModel.findById(userId).select('groupId submittedassignments')
    ]);

    // FIX 5: Move all validation checks together for clarity.
    if (!assignment) {
      return next(new Error("Assignment not found", { cause: 404 }));
    }
    if (!student) {
      // This case is unlikely if isAuth is correct, but it's good practice to keep it.
      return next(new Error("Student not found", { cause: 404 }));
    }

    // --- Business Logic Checks ---
    if (assignment.rejectedStudents?.some(id => id.equals(userId))) {
      return next(new Error("You are blocked from submitting this assignment", { cause: 403 }));
    }

    const assignmentGroupIdsStr = assignment.groupIds.map(id => id.toString());
    if (!assignmentGroupIdsStr.includes(student.groupId.toString())) {
        return next(new Error("You are not in the right group for this assignment", { cause: 403 }));
    }
    
    const now = new Date();
    if (now < assignment.startDate) {
      return next(new Error("The submission window has not opened yet", { cause: 403 }));
    }
    const isLate = now > assignment.endDate;

    // --- File Upload Logic ---
    // FIX 6: Dynamically get the file extension from the original uploaded file.
    const fileExtension = path.extname(file.originalname); 
    const timestamp = Date.now();
    const fileName = `${assignment.name}_${userName}_${timestamp}${fileExtension}`;
    const key = `Submissions/${assignmentId}/${userId}/${fileName}`;

    // Use a stream for efficient memory usage
    const fileStream = fsSync.createReadStream(file.path);

    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: fileStream,
      // FIX 7: Use the MIME type detected by multer.
      ContentType: file.mimetype,
      // Note: ACL is deprecated. Prefer using Bucket Policies for access control.
    }));

    // FIX 8: Do not shadow the global `Date` object.
    const submissionDate = new Date();

    // --- Database Update Logic ---
    const submission = await SubassignmentModel.create({
      studentId: userId,
      assignmentId,
      bucketName: process.env.S3_BUCKET_NAME,
      groupId: student.groupId,
      key,
      SubmitDate: submissionDate,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      isLate,
      notes: notes || (isLate 
        ? `Late submission on ${submissionDate.toISOString()}` 
        : `Submitted on time at ${submissionDate.toISOString()}`),
    });

    student.submittedassignments.addToSet(assignmentId);
    await student.save();

    // --- Success Response ---
    res.status(200).json({
      message: "Assignment submitted successfully",
      data: submission,
    });

  } catch (err) {
    console.error("Error in submitAssignment:", err);
    return next(new Error("Failed to submit the assignment due to a server error.", { cause: 500 }));
  } finally {
    // This block will run whether the try block succeeded or failed.
    // It ensures we always clean up the uploaded file from the server's temp directory.
    await fs.unlink(file.path).catch(err => console.error(`Failed to delete temp file: ${file.path}`, err));
  }
});
