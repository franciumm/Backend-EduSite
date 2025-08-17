import { asyncHandler } from "../../../utils/erroHandling.js";
import {  PutObjectCommand ,GetObjectCommand} from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import { groupModel } from "../../../../DB/models/groups.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import mongoose from "mongoose";
import { toZonedTime } from 'date-fns-tz';
import { deleteFileFromS3, uploadFileToS3 } from '../../../utils/S3Client.js';
import { canAccessContent, canViewSubmissionsFor } from '../../../middelwares/contentAuth.js';
import { assignmentModel } from '../../../../DB/models/assignment.model.js';
import { s3 } from '../../../utils/S3Client.js';
import fs from "fs";
import { promises as fsPromises } from 'fs';
import { CONTENT_TYPES } from "../../../utils/constants.js"; 
import path from "path"; 
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { synchronizeContentStreams } from '../../../utils/streamHelpers.js';



export const downloadAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId } = req.query;

    // Use the now-imported authorizer to correctly check permissions.
   const hasAccess = await canAccessContent({
        user: req.user,
         isTeacher: req.isteacher, 
        contentId: assignmentId,
        contentType: CONTENT_TYPES.ASSIGNMENT
    });
    if (!hasAccess ) {
        return next(new Error("You are not authorized to access this assignment.", { cause: 403 }));
    }

    const assignment = await assignmentModel.findById(assignmentId).select('bucketName key startDate endDate allowSubmissionsAfterDueDate').lean();
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }

 
    const { bucketName, key } = assignment;
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3.send(command);

    res.setHeader("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
    res.setHeader("Content-Type", response.ContentType);
    response.Body.pipe(res);
});

export const editAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId, groupIds,...updateData } = req.body;
    const assignmentFile = req.files?.file?.[0];
    const answerFile = req.files?.answerFile?.[0];
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
    }
    const session = await mongoose.startSession();

  
    try {
        // Handle new main assignment file upload
        session.startTransaction();

        const assignment = await assignmentModel.findById(assignmentId).session(session);
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }


     const isMainTeacher = req.user.role === 'main_teacher';
    const isOwner = assignment.createdBy.equals(req.user._id);

    if (!isMainTeacher && !isOwner) {
        return next(new Error("You are not authorized to edit this assignment.", { cause: 403 }));
    }
 const oldGroupIds = assignment.groupIds;
        if (groupIds) { // Only run if groupIds are part of the update
            await synchronizeContentStreams({
                content: assignment,
                oldGroupIds: oldGroupIds,
                newGroupIds: groupIds,
                session
            });
            assignment.groupIds = groupIds; // Update the document
        }
       

  

        if (assignmentFile) {
            if (assignment.key) {
                await deleteFileFromS3(assignment.bucketName, assignment.key).catch(err => console.error("Non-critical error: Failed to delete old assignment file during edit:", err));
            }
            const fileContent = await fsPromises.readFile(assignmentFile.path);
            const newKey = `assignments/${assignment.slug}-${Date.now()}${path.extname(assignmentFile.originalname)}`;
            await uploadFileToS3(process.env.S3_BUCKET_NAME, newKey, fileContent, assignmentFile.mimetype);
            
            assignment.key = newKey;
            assignment.path = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${newKey}`;
            assignment.bucketName = process.env.S3_BUCKET_NAME;
        }

        // Handle new answer file upload
        if (answerFile) {
            if (assignment.answerKey) {
                await deleteFileFromS3(assignment.answerBucketName, assignment.answerKey).catch(err => console.error("Non-critical error: Failed to delete old answer file during edit:", err));
            }
            const answerContent = await fsPromises.readFile(answerFile.path);
            const newAnswerKey = `assignments/answers/${assignment.slug}-answer-${Date.now()}${path.extname(answerFile.originalname)}`;
            await uploadFileToS3(process.env.S3_BUCKET_NAME, newAnswerKey, answerContent, answerFile.mimetype);

            assignment.answerKey = newAnswerKey;
            assignment.answerPath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${newAnswerKey}`;
            assignment.answerBucketName = process.env.S3_BUCKET_NAME;
        }

              Object.assign(assignment, updateData);

        const updatedAssignment = await assignment.save({ session });
  await session.commitTransaction();
        res.status(200).json({
            message: "Assignment updated successfully.",
            assignment: updatedAssignment,
        });
    }catch (error) {
        // 8. If ANY error occurred, abort the entire transaction
        await session.abortTransaction();
        // Forward the error to the global error handler
        return next(error);}
         finally {

                    await session.endSession();

        if ( req.files?.file?.[0].path) await fsPromises.unlink(req.files?.file?.[0].path).catch(e => console.error("Error deleting temp assignment file", e));
        if (answerFile?.path) await fsPromises.unlink(answerFile.path).catch(e => console.error("Error deleting temp answer file", e));
    }
});


export const downloadAssignmentAnswer = asyncHandler(async (req, res, next) => {
    const { assignmentId } = req.query;
    const { user, isteacher } = req;
    const uaeTimeZone = 'Asia/Dubai';
    const nowInUAE = toZonedTime(new Date(), uaeTimeZone);

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
    }

    const assignment = await assignmentModel.findById(assignmentId).select('endDate allowSubmissionsAfterDueDate answerKey answerBucketName name').lean();
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }
    if (!assignment.answerKey || !assignment.answerBucketName) {
        return next(new Error("No answer file exists for this assignment.", { cause: 404 }));
    }

    // Authorization Logic
    if (!isteacher) {
        // Rule 1: Deadline must have passed
        if (nowInUAE < new Date(assignment.endDate)) {
            return next(new Error("The answer file is not available until the deadline has passed.", { cause: 403 }));
        }

        // Rule 2: If late submissions are allowed, student must have submitted first
        if (assignment.allowSubmissionsAfterDueDate) {
                        return next(new Error("The answer file is not available until the teacher disallow the submission.", { cause: 403 }));

        }
    }
    
    // If we reach here, user is authorized. Stream the file.
    const { answerBucketName, answerKey, name } = assignment;
    try {
        const command = new GetObjectCommand({ Bucket: answerBucketName, Key: answerKey });
        const s3Response = await s3.send(command);
        const safeFilename = encodeURIComponent(name.replace(/[^a-zA-Z0-9.\-_]/g, '_') + '-ANSWER' + path.extname(answerKey));
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
        res.setHeader('Content-Type', s3Response.ContentType);
        if (s3Response.ContentLength) res.setHeader('Content-Length', s3Response.ContentLength);
        
        s3Response.Body.pipe(res);
    } catch (error) {
        console.error(`S3 Answer File Streaming Error for key ${answerKey}:`, error);
        return next(new Error("Failed to download the answer file from storage.", { cause: 500 }));
    }
});


export const downloadSubmittedAssignment = asyncHandler(async (req, res, next) => {
    const { submissionId } = req.query;

    if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("Submission ID is required and must be valid.", { cause: 400 }));
    }

    const submission = await SubassignmentModel.findById(submissionId)
        .populate("assignmentId", "name") // Populate to get assignment details
        .populate("studentId", "userName"); // Populate to get student details

    if (!submission) {
        return next(new Error("Submission not found", { cause: 404 }));
    }

    
    let isAuthorized = false;
    if (!req.isteacher && req.user._id.equals(submission.studentId)) {
        isAuthorized = true;
    } else if (req.isteacher) {
        isAuthorized = await canViewSubmissionsFor({
            user: req.user,
            isTeacher: true,
            contentId: submission.assignmentId,
            contentType:CONTENT_TYPES.ASSIGNMENT
        });
       
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to download this submission.", { cause: 403 }));
    }
 res.status(200).json({
    submission
 })
});

export const markAssignment = asyncHandler(async (req, res, next) => {
  const { submissionId, score, notes, annotationData ,feedback} = req.body;
    if (!submissionId) return next(new Error("Submission ID is required.", { cause: 400 }));

  const submission = await SubassignmentModel.findById(submissionId).populate("assignmentId studentId");
  
  
  
  if (!submission) {
    return next(new Error("Submission not found", { cause: 404 }));
  }

 
if (!req.isteacher) return next(new Error("Forbidden.", { cause: 403 }));
     const hasAccess = await canViewSubmissionsFor({
        user: req.user,
        isTeacher: true,
        contentId: submission.assignmentId,
        contentType:  CONTENT_TYPES.ASSIGNMENT 
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to mark submissions for this assignment.", { cause: 403 }));
    }

  try {
   
    

   
    submission.score = score || submission.score; 
    submission.notes = notes || submission.notes;
    submission.isMarked = true; 
    submission.teacherFeedback =feedback || submission.teacherFeedback;
    submission.annotationData = annotationData|| submission.annotationData ;
   await submissionStatusModel.updateOne(
            { studentId: submission.studentId, contentId: submission.assignmentId, contentType: 'assignment' },
            { status: 'marked', score: submission.score }
        );
      await submission.save();

    res.status(200).json({
      message: "Submission marked and replaced successfully",
      updatedSubmission: submission,
    });
  } catch (error) {
    console.error("Error marking and replacing the submission:", error);

    return next(new Error("Failed to mark and replace the submission", { cause: 500 }));
  }
});

export const deleteAssignmentWithSubmissions = asyncHandler(async (req, res, next) => {
    const { assignmentId } = req.body;
    if (!req.isteacher) return next(new Error("Forbidden.", { cause: 403 }));
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
 const assignment = await assignmentModel.findById(assignmentId);
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }
    const isMainTeacher = req.user.role === 'main_teacher';
    const isOwner = assignment.createdBy.equals(req.user._id);
     if (!isMainTeacher && !isOwner) {
        return next(new Error("You are not authorized to delete this assignment.", { cause: 403 }));
    }
   await Promise.all([
        contentStreamModel.deleteMany({ contentId: assignmentId }),
        submissionStatusModel.deleteMany({ contentId: assignmentId, contentType: 'assignment' })
    ]);
 
 await assignment.deleteOne();
    res.status(200).json({
        message: "Assignment and all related data deleted successfully.",
    });
});

export const deleteSubmittedAssignment = asyncHandler(async (req, res, next) => {
    const { submissionId } = req.body;
    const { user, isteacher } = req;

    if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }
const submission = await SubassignmentModel.findById(submissionId);
    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    
    let isAuthorized = false;
    if (!req.isteacher && req.user._id.equals(submission.studentId)) {
        isAuthorized = true; // Student owner
    } else if (req.isteacher) {
        // *** FIX: Use centralized helper for all teachers ***
        isAuthorized = await canViewSubmissionsFor({
            user: req.user,
            isTeacher: true,
            contentId: submission.assignmentId,
            contentType: CONTENT_TYPES.ASSIGNMENT
        });
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
      await submissionStatusModel.updateOne(
        { studentId: submission.studentId, contentId: submission.assignmentId, contentType: 'assignment' },
        { 
            $set: { status: 'assigned' },
            // Unset fields that are no longer relevant
            $unset: { submissionId: "", score: "", isLate: "", SubmitDate: "" }
        }
    );

    
    await submission.deleteOne();

    res.status(200).json({ message: "Submission deleted successfully." });
});