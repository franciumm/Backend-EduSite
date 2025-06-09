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


export const submitAssignment = asyncHandler(async (req, res, next) => {
  const { assignmentId, notes } = req.body;

  // Check if the assignment exists
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }
  const groupId= await studentModel.findById(req.user._id);
  groupId= groupId.groupId;
  const group = await groupModel.findById(groupId);
  if (!group) {
    return next(new Error("Group not found", { cause: 404 }));
  }
  // Check if the student is blocked from submitting this assignment
  if (assignment.rejectedStudents?.includes(req.user._id)) {
    return next(new Error("You are not allowed to submit this assignment", { cause: 403 }));
  }

  // Validate timeline for submission
  const currentDate = new Date();
  let isLate = false;

  if (req.isteacher.teacher === false && currentDate < assignment.startDate) {
    return next(
      new Error("You cannot submit this assignment. The timeline has not started yet.", { cause: 403 })
    );
  }

  if (req.isteacher.teacher === false && currentDate > assignment.endDate) {
    isLate = true;
  }

  // Check if the student is in the correct group for this assignment
  if (
    req.isteacher.teacher === false &&
    assignment.groupId.toString() !== req.user.groupid.toString()
  ) {
    return next(
      new Error("You are not part of the group assigned to this assignment.", { cause: 403 })
    );
  }

  // Ensure the file is uploaded
  if (!req.file) {
    return next(new Error("Please upload a PDF file", { cause: 400 }));
  }

  // Generate unique file name for S3
  const fileName = `${assignment.name}_${req.user.userName}_${Date.now()}.pdf`; // AssignmentName_Username_Timestamp

  // Upload the file to S3
  const fileContent = fs.readFileSync(req.file.path); // Read the file from disk
  const s3Key = `Submissions/${assignmentId}/${req.user._id}/${fileName}`; // Path in S3
  const s3Params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: "application/pdf",
    ACL: "private",
  };

  try {
    // Upload the file to S3
    await s3.send(new PutObjectCommand(s3Params));

    // Save the submission in the database
    const submission = await SubassignmentModel.create({
      studentId: req.user._id,
      assignmentId: assignmentId,
      bucketName: process.env.S3_BUCKET_NAME,groupId,
      key: s3Key,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      isLate,
      notes: notes || (isLate ? `Late submission on ${currentDate.toISOString()}` : `Submitted on time`),
    });

    // Add the assignment to the student's submitted assignments list if not already added
    await studentModel.findByIdAndUpdate(req.user._id, {
      $addToSet: { submittedassignments: assignmentId },
    });

    // Cleanup: Remove the file from the local disk
    fs.unlinkSync(req.file.path);

    // Respond with success
    res.status(200).json({
      message: "Assignment submitted successfully",
      submission,
      isLate,
    });
  } catch (error) {
    console.error("Error during file upload or database operation:", error);

    // Cleanup: Remove the file from local disk if error occurs
    fs.unlinkSync(req.file.path);

    return next(new Error("Failed to submit the assignment", { cause: 500 }));
  }
});