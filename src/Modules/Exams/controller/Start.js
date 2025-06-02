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
  const { Name, startdate, enddate, grade, groupIds, exceptionStudents } = req.body;

  // Validate groupIds
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return next(new Error("Group IDs are required and should be an array", { cause: 400 }));
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
      grade,
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
  const { examId } = req.body;
  const notes = req.body.notes || "";
  const user = req.user;
  const isTeacher = req.isteacher.teacher;

  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("Valid examId is required", { cause: 400 }));
  }

  if (!req.file) {
    return next(new Error("Please upload a PDF file for submission", { cause: 400 }));
  }

  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  let studentId;
  if (isTeacher) {
    studentId = user._id;
  } else {
    studentId = user._id;
    const a7a = await studentModel.findById(user._id);
    const isInGroup = exam.groupIds.some((gid) => gid.toString() === a7a.groupId?.toString());
    const exceptionEntry = exam.exceptionStudents.find(
      (ex) => ex.studentId.toString() === studentId.toString()
    );

    if (!isInGroup && !exceptionEntry) {
      return next(new Error("You are not authorized to submit for this exam.", { cause: 403 }));
    }

    const now = new Date();
    if (exceptionEntry) {
      if (now < exceptionEntry.startdate || now > exceptionEntry.enddate) {
        return next(new Error("Exam submission is not allowed (exception timeline).", { cause: 403 }));
      }
    } else {
      if (now < exam.startdate || now > exam.enddate) {
        return next(new Error("Exam submission is not allowed (main timeline).", { cause: 403 }));
      }
    }
  }

  const fileContent = fs.readFileSync(req.file.path);
  const fileName = `Submission_${examId}_${studentId}_${Date.now()}.pdf`;
  const s3Key = `ExamSubmissions/${fileName}`;

  try {
    await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");
    fs.unlinkSync(req.file.path);

    const existingSubmission = await SubexamModel.findOne({ examId, studentId });

    if (existingSubmission?.fileKey) {
await s3.send(new DeleteObjectCommand({
  Bucket: process.env.S3_BUCKET_NAME,
  Key: exam.key
}));await deleteFileFromS3(process.env.S3_BUCKET_NAME, existingSubmission.fileKey);
    }

    const updatedSubmission = await SubexamModel.findOneAndUpdate(
      { examId, studentId },
      {
        examId,
        studentId,
        notes,
        fileBucket: process.env.S3_BUCKET_NAME,
        fileKey: s3Key,
        filePath: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
      },
      { new: true, upsert: true }
    );

    res.status(200).json({
      message: "Exam submitted successfully",
      submission: updatedSubmission,
    });
  } catch (err) {
    console.error("Error during submission:", err);
    return next(new Error("Failed to submit the exam", { cause: 500 }));
  }
});