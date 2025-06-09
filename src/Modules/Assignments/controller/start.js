import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {SubassignmentModel}from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import {groupModel} from "../../../../DB/models/groups.model.js";
import fs from "fs";

import { promisify } from "util";

export const CreateAssignment = asyncHandler(async (req, res, next) => {
  const { _id } = req.user; // The teacher creating the assignment
  const { name, startDate, endDate, groupId, gradeId } = req.body;
  
  const slug = slugify(name, "-");

  // Check if the assignment name already exists for this group
  if (await assignmentModel.findOne({ name, groupId })) {
    return next(new Error("Assignment name is already created for this group", { cause: 400 }));
  }
 
  

  if (!req.file) {
    return next(new Error("Please upload a PDF file", { cause: 400 }));
  }

  // Read file from disk
  const fileContent = fs.readFileSync(req.file.path);
  const fileName = `${slug}-${Date.now()}.pdf`; // Generate unique filename
  const s3Key = `Assignments/${fileName}`; // File path in S3


  
  try {
    // Upload the file to S3
    await uploadFileToS3(
      process.env.S3_BUCKET_NAME,
      s3Key,
      fileContent,
      "application/pdf" // MIME type
    );

    // Create the assignment in the database
    const newAssignment = await assignmentModel.create({
      name,
      slug,
      startDate,
      endDate,
      groupId,
      gradeId,
      bucketName: process.env.S3_BUCKET_NAME,
      key: s3Key,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`, // URL for accessing the file
      createdBy: _id,
    });

    if (!newAssignment) {
      // If creation fails, delete the uploaded file from S3
      await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key);
      return next(new Error("Error while creating the assignment", { cause: 400 }));
    }

    // Success response
    res.status(200).json({ message: "Assignment created successfully", newAssignment });
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    return next(new Error("Error while uploading file to S3", { cause: 500 }));
  } finally {
    // Cleanup: Remove file from local disk after uploading to S3
    fs.unlinkSync(req.file.path);
  }
});
// controllers/assignment.controller.js




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

    // 6) Save record
    const submission = await SubassignmentModel.create({
      studentId: userId,
      assignmentId,
      bucketName: process.env.S3_BUCKET_NAME,
      groupId,
      key,
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