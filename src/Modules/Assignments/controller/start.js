import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {SubassignmentModel}from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import {groupModel} from "../../../../DB/models/groups.model.js";
import fs from "fs";

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
// export const submitAssignment = asyncHandler(async (req, res, next) => {
//   const { assignmentId, notes } = req.body;

//   // 1) Fetch the assignment
//   const assignment = await assignmentModel.findById(assignmentId);
//   if (!assignment) {
//     return next(new Error("Assignment not found", { cause: 404 }));
//   }

//   // 2) Fetch the student and their groupId
//   const student = await studentModel.findById(req.user._id);
//   if (!student) {
//     return next(new Error("Student not found", { cause: 404 }));
//   }
//   const groupId = student.groupId;

//   // 3) Verify the group exists
//   const group = await groupModel.findById(groupId);
//   if (!group) {
//     return next(new Error("Group not found", { cause: 404 }));
//   }

//   // 4) Check rejection list
//   if (assignment.rejectedStudents?.includes(req.user._id)) {
//     return next(new Error("You are not allowed to submit this assignment", { cause: 403 }));
//   }

//   // 5) Timeline validation
//   const now = new Date();
//   let isLate = false;
//   if (!req.isteacher.teacher && now < assignment.startDate) {
//     return next(new Error("Submission window hasn’t opened yet", { cause: 403 }));
//   }
//   if (!req.isteacher.teacher && now > assignment.endDate) {
//     isLate = true;
//   }

//   // 6) Group check (use student.groupId, not req.user.groupid)
//   if (!req.isteacher.teacher && assignment.groupId.toString() !== groupId.toString()) {
//     return next(new Error("You’re not in the group for this assignment", { cause: 403 }));
//   }

//   // 7) Ensure file
//   if (!req.file) {
//     return next(new Error("Please upload a PDF file", { cause: 400 }));
//   }

//   // 8) Upload to S3
//   const fileContent = fs.readFileSync(req.file.path);
//   const fileName = `${assignment.name}_${req.user.userName}_${Date.now()}.pdf`;
//   const s3Key = `Submissions/${assignmentId}/${req.user._id}/${fileName}`;
//   try {
//     await s3.send(new PutObjectCommand({
//       Bucket: process.env.S3_BUCKET_NAME,
//       Key: s3Key,
//       Body: fileContent,
//       ContentType: "application/pdf",
//       ACL: "private",
//     }));

//     // 9) Save in DB
//     const submission = await SubassignmentModel.create({
//       studentId: req.user._id,
//       assignmentId,
//       bucketName: process.env.S3_BUCKET_NAME,
//       groupId,
//       key: s3Key,
//       path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
//       isLate,
//       notes: notes || (isLate ? `Late submission on ${now.toISOString()}` : `Submitted on time`),
//     });

//     // 10) Track on student doc
//     await studentModel.findByIdAndUpdate(req.user._id, {
//       $addToSet: { submittedassignments: assignmentId },
//     });

//     // 11) Cleanup & respond
//     fs.unlinkSync(req.file.path);
//     res.status(200).json({
//       message: "Assignment submitted successfully",
//       data: { submission, isLate },
//     });
//   } catch (err) {
//     // ensure cleanup
//     fs.unlinkSync(req.file.path);
//     console.error(err);
//     return next(new Error("Failed to submit the assignment", { cause: 500 }));
//   }
// });

export const submitAssignment = asyncHandler(async (req, res, next) => {
  
  const { notes,assignmentId } = req.body;
  const file = req.file;

  // 1) Validate assignment
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 2) Validate student & group
  const student = await studentModel.findById(req.user._id);
  if (!student) {
    return next(new Error("Student not found", { cause: 404 }));
  }
  const groupId = student.groupId;
  const group = await groupModel.findById(groupId);
  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }

  // 3) Rejection check
  if (assignment.rejectedStudents?.includes(req.user._id)) {
    return next(new Error("You are blocked from submitting this assignment", { cause: 403 }));
  }

  // 4) Timeline check
  const now = new Date();
  let isLate = false;
  if (!req.isteacher.teacher && now < assignment.startDate) {
    return next(new Error("Submission window hasn’t opened yet", { cause: 403 }));
  }
  if (!req.isteacher.teacher && now > assignment.endDate) {
    isLate = true;
  }

  // 5) Group match
  if (!req.isteacher.teacher && assignment.groupId.toString() !== groupId.toString()) {
    return next(new Error("You’re not in the right group for this assignment", { cause: 403 }));
  }

  // 6) File check
  if (!file) {
    return next(new Error("Please attach a PDF file under field name `file`", { cause: 400 }));
  }

  // 7) Upload to S3
  const buffer = fs.readFileSync(file.path);
  const fileName = `${assignment.name}_${req.user.userName}_${Date.now()}.pdf`;
  const key = `Submissions/${assignmentId}/${req.user._id}/${fileName}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
      ACL: "private",
    }));

    // 8) Record in DB
    const submission = await SubassignmentModel.create({
      studentId: req.user._id,
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

    // 9) Track on student doc
    await studentModel.findByIdAndUpdate(req.user._id, {
      $addToSet: { submittedassignments: assignmentId },
    });

    // 10) Cleanup tmp file
    fs.unlinkSync(file.path);

    // 11) Send back
    res.status(200).json({
      message: "Assignment submitted successfully",
      data: submission,
    });

  } catch (err) {
    // ensure we don’t leave stale files
    fs.unlinkSync(file.path);
    console.error("Upload/DB error:", err);
    return next(new Error("Failed to submit the assignment", { cause: 500 }));
  }
});