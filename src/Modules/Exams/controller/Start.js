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
import fs from "fs";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";


export const createExam = asyncHandler(async (req, res, next) => {
  const { Name, startdate, enddate, gradeId, exceptionStudents } = req.body;

  const gradedoc= await gradeModel.findById(gradeId);
  if(!gradedoc){
      return next(new Error("wrong GradeId ", { cause: 400 }));
  }
    let raw = req.body.groupIds ?? req.body["groupIds[]"];
  if (!raw) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
  }

  // ─── 2) If they sent JSON text, parse it  
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      raw = JSON.parse(raw);
    } catch {
      // not valid JSON – fall back below
    }
  }

  let groupIds = Array.isArray(raw) ? raw : [raw];

  if ( groupIds.length === 0) {
    return next(new Error('Group IDs are required and should be an array ', { cause: 400 }));
  }

  const invalidGroupIds = groupIds.filter(
    (groupId) => !mongoose.Types.ObjectId.isValid(groupId)
  );
  if (invalidGroupIds.length > 0) {
    return next(
      new Error(`Invalid Group ID(s): ${invalidGroupIds.join(", ")}`, { cause: 400 })
    );
  }

  const validGroupIds = groupIds.map((groupId) => new mongoose.Types.ObjectId(groupId));

  // Validate the file
  if (!req.file) {
    return next(new Error("Please upload a PDF file for the exam", { cause: 400 }));
  }

  // Validate start and end dates
  const currentDate = new Date();
  if (new Date(startdate) < currentDate) {
    return next(new Error("Start date cannot be in the past", { cause: 400 }));
  }
  if (new Date(startdate) >= new Date(enddate)) {
    return next(new Error("End date must be after the start date", { cause: 400 }));
  }

  // Validate that all groups exist
  const groups = await groupModel.find({ _id: { $in: validGroupIds } });
  if (!groups || groups.length !== groupIds.length) {
    return next(new Error("One or more Group IDs were not found", { cause: 404 }));
  }

  // Check for duplicate exam name in any of the provided groups
  const duplicateExam = await examModel.findOne({
    Name,
    groupIds: { $in: validGroupIds },
  });
  if (duplicateExam) {
    return next(
      new Error(
        "An exam with this name already exists for one of the selected groups",
        { cause: 400 }
      )
    );
  }

  // Validate and format exceptionStudents if provided
  let formattedExceptions = [];
  if (exceptionStudents && Array.isArray(exceptionStudents)) {
    formattedExceptions = exceptionStudents.map((ex) => {
      if (!ex.studentId || !mongoose.Types.ObjectId.isValid(ex.studentId)) {
        throw new Error(`Invalid studentId in exceptionStudents`);
      }
      if (!ex.startdate || !ex.enddate) {
        throw new Error(`Missing start/end date for an exception student`);
      }
      if (new Date(ex.startdate) >= new Date(ex.enddate)) {
        throw new Error(
          `Exception student has end date before or equal to start date`
        );
      }
      return {
        studentId: new mongoose.Types.ObjectId(ex.studentId),
        startdate: new Date(ex.startdate),
        enddate: new Date(ex.enddate),
      };
    });
  }

  // Upload the exam PDF to S3
  const fileName = `${Name.replace(/\s+/g, "_")}_${Date.now()}.pdf`; // Unique file name
  const fileContent = fs.readFileSync(req.file.path);
  const s3Key = `Exams/${fileName}`;

  try {
    await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");
    fs.unlinkSync(req.file.path);

    const exam = await examModel.create({
      Name,
      startdate,
      enddate,
      grade: gradeId,
      groupIds: validGroupIds,
      bucketName: process.env.S3_BUCKET_NAME,
      key: s3Key,
      path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      createdBy: req.user._id,
      exceptionStudents: formattedExceptions,
    });

    return res.status(201).json({
      message: "Exam created successfully",
      exam,
    });
  } catch (error) {
    console.error("Error creating exam:", error);

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return next(new Error("Error creating exam", { cause: 500 }));
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