import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {SubassignmentModel}from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import {groupModel} from "../../../../DB/models/groups.model.js";
import fs from "fs";
import { promises as fsPromises } from 'fs';
import { gradeModel } from "../../../../DB/models/grades.model.js";
import mongoose from "mongoose";
import path from 'path'; // To handle file extensions


export const CreateAssignment  = asyncHandler(async (req, res, next) => {
  const teacherId = req.user._id;
  const { name, startDate, endDate, gradeId } = req.body;
  const slug = slugify(name, "-");

  // ── 1) Normalize & validate groupIds input ────────────────────────────────
  let raw = req.body.groupIds ?? req.body["groupIds[]"];
  if (!raw) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
  }
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { raw = JSON.parse(raw); } catch {}
  }
  let groupIds = Array.isArray(raw) ? raw : [raw];
  if (groupIds.length === 0) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
  }
  const invalid = groupIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    return next(new Error(`Invalid Group ID(s): ${invalid.join(", ")}`, { cause: 400 }));
  }
  const validGroupIds = groupIds.map(id => new mongoose.Types.ObjectId(id));

  // ── 2) Check duplicate assignment name in any of these groups ─────────────
  const duplicate = await assignmentModel.findOne({
    name,
    groupIds: { $in: validGroupIds }
  });
  if (duplicate) {
    return next(new Error(
      "An assignment with this name already exists for one of the selected groups",
      { cause: 400 }
    ));
  }

  // ── 3) Validate gradeId exists ─────────────────────────────────────────────
  const gradeDoc = await gradeModel.findById(gradeId);
  if (!gradeDoc) {
    return next(new Error("Wrong GradeId", { cause: 400 }));
  }

  // ── 4) Ensure all groups belong to that grade ─────────────────────────────
  const groupsInGrade = await groupModel.find({
    _id: { $in: validGroupIds },
    gradeid: gradeDoc._id
  }).select("_id");
  if (groupsInGrade.length !== validGroupIds.length) {
    return next(new Error(
      "One or more groups are not in the specified grade",
      { cause: 400 }
    ));
  }

  // ── 5) File must be present ────────────────────────────────────────────────
  if (!req.file) {
    return next(new Error("Please upload a PDF file", { cause: 400 }));
  }

  // ── 6) Read & upload to S3 ────────────────────────────────────────────────
  const fileContent = fs.readFileSync(req.file.path);
  const fileName = `${slug}-${Date.now()}.pdf`;
  const s3Key = `Assignments/${fileName}`;
  try {
    await uploadFileToS3(
      process.env.S3_BUCKET_NAME,
      s3Key,
      fileContent,
      "application/pdf"
    );

    // ── 7) Persist the assignment with validated groupIds ────────────────────
    const newAssignment = await assignmentModel.create({
      name,
      slug,
      startDate,
      endDate,
      gradeId,
      groupIds: validGroupIds,
      bucketName: process.env.S3_BUCKET_NAME,
      key: s3Key,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      createdBy: teacherId,
    });

    if (!newAssignment) {
      await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key);
      return next(new Error("Error while creating the assignment", { cause: 400 }));
    }

    res.status(201).json({
      message: "Assignment created successfully",
      newAssignment
    });
  } catch (err) {
    console.error("Error uploading assignment to S3:", err);
    return next(new Error("Error while uploading file to S3", { cause: 500 }));
  } finally {
    fs.unlinkSync(req.file.path);
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
