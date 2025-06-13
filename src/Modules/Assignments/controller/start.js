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
  const userId = req.user._id;
  const isTeacher = req.isteacher?.teacher === true;

  // 1) File must be there
  if (!file) {
    return next(new Error("Please attach a PDF file under field name `file`", { cause: 400 }));
  }

  // 2) Fetch assignment
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 3) Fetch student + group
  const student = await studentModel.findById(userId);
  if (!student) {
    return next(new Error("Student not found", { cause: 404 }));
  }
  const groupId = student.groupId;
  const group = await groupModel.findById(groupId);
  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }

  // 4) Rejection + timeline checks
  if (assignment.rejectedStudents?.includes(userId)) {
    return next(new Error("You’re blocked from submitting this assignment", { cause: 403 }));
  }
  const now = new Date();
  if (!isTeacher && now < assignment.startDate) {
    return next(new Error("Submission window hasn’t opened yet", { cause: 403 }));
  }
  const isLate = !isTeacher && now > assignment.endDate;
  if (!isTeacher && assignment.groupId.toString() !== groupId.toString()) {
    return next(new Error("You’re not in the right group for this assignment", { cause: 403 }));
  }

  // 5) Stream upload to S3
  const timestamp = Date.now();
  const fileName = `${assignment.name}_${req.user.userName}_${timestamp}.pdf`;
  const key = `Submissions/${assignmentId}/${userId}/${fileName}`;
  const fileStream = fs.createReadStream(file.path);

  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ContentType: "application/pdf",
      ACL: "private",
    }));
    const Date = new Date();
    // 6) Save record
    const submission = await SubassignmentModel.create({
      studentId: userId,
      assignmentId,
      bucketName: process.env.S3_BUCKET_NAME,
      groupId,
      key,
      SubmitDate:Date,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      isLate,
      notes: notes || (isLate 
        ? `Late submission on ${now.toISOString()}` 
        : `Submitted on time at ${now.toISOString()}`),
    });

    // 7) Track on student
    await studentModel.findByIdAndUpdate(userId, {
      $addToSet: { submittedassignments: assignmentId },
    });

    // 8) Cleanup + respond
    await fsPromises.unlink(file.path);
    res.status(200).json({
      message: "Assignment submitted successfully",
      data: submission,
    });

  } catch (err) {
    // always cleanup
    await fsPromises.unlink(file.path);
    console.error("Upload/DB error:", err);
    return next(new Error("Failed to submit the assignment", { cause: 500 }));
  }
});