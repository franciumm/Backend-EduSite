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



export const downloadAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId } = req.query;

    // Use the now-imported authorizer to correctly check permissions.
    const hasAccess = await canAccessContent({
        user: req.user, // Pass the entire user object
        isTeacher: req.isteacher.teacher, // Pass isTeacher as a separate property
        contentId: assignmentId,
        contentType: 'assignment'
    });
    if (!hasAccess ) {
        return next(new Error("You are not authorized to access this assignment.", { cause: 403 }));
    }

    const assignment = await assignmentModel.findById(assignmentId).select('bucketName key startDate endDate allowSubmissionsAfterDueDate').lean();
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }

    // This timeline check remains a good secondary validation for students.
    if (req.isteacher.teacher === false) {
        const uaeTimeZone = 'Asia/Dubai';
        const now = toZonedTime(new Date(), uaeTimeZone);
        if ((now < assignment.startDate || now > assignment.endDate) && !assignment.allowSubmissionsAfterDueDate) {
            return next(new Error(`This Assignment is not available at this time.`, { cause: 200 }));
        }
    }

    const { bucketName, key } = assignment;
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3.send(command);

    res.setHeader("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
    res.setHeader("Content-Type", response.ContentType);
    response.Body.pipe(res);
});

export const editAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId, ...updateData } = req.body;
    const teacherId = req.user._id;

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
    }

    const assignment = await assignmentModel.findById(assignmentId);
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }

    if (!assignment.createdBy.equals(teacherId)) {
        return next(new Error("You are not authorized to edit this assignment.", { cause: 403 }));
    }

    if (req.file) {
        if (assignment.key) {
            await deleteFileFromS3(assignment.bucketName, assignment.key)
                .catch(err => console.error("Non-critical error: Failed to delete old S3 file during edit:", err));
        }

        // Use the aliased 'fsPromises' for async file reading
        const fileContent = await fsPromises.readFile(req.file.path);
        const newKey = `assignments/${assignment.slug}-${Date.now()}.pdf`;
        
        await uploadFileToS3(process.env.S3_BUCKET_NAME, newKey, fileContent, "application/pdf");
        
        assignment.key = newKey;
        assignment.path = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${newKey}`;
        assignment.bucketName = process.env.S3_BUCKET_NAME;

        // Use the aliased 'fsPromises' for async file deletion
        await fsPromises.unlink(req.file.path);
    }

    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined && updateData[key] !== null) {
            assignment[key] = updateData[key];
        }
    });
    
    const updatedAssignment = await assignment.save();

    res.status(200).json({
        message: "Assignment updated successfully.",
        assignment: updatedAssignment,
    });
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
    if (req.user._id.equals(submission.studentId._id)) {
        isAuthorized = true;
    } else if (req.isteacher.teacher) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to download this submission.", { cause: 403 }));
    }
    const { bucketName, key } = submission;
 res.status(200).json({
    submission
 })
});

export const markAssignment = asyncHandler(async (req, res, next) => {
  const { submissionId, score, notes, annotationData } = req.body;

  const submission = await SubassignmentModel.findById(submissionId).populate("assignmentId studentId");
  
  

 

  try {
   
    

   
    submission.score = score || submission.score; 
    submission.notes = notes || submission.notes;
    submission.isMarked = true; 
    submission.annotationData = annotationData;
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
    const teacherId = req.user._id;

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
    }

    // FIX: Fetch the full document
    const assignment = await assignmentModel.findById(assignmentId);
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }

    // Authorization
    if (!assignment.createdBy.equals(teacherId)) {
        return next(new Error("You are not authorized to delete this assignment.", { cause: 403 }));
    }

    // FIX: This single line triggers the powerful cascading delete middleware you wrote.
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

    // FIX: Fetch the full document, not a .lean() object
    const submission = await SubassignmentModel.findById(submissionId);
    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // Authorization logic is fine, but we need the full document for it
    const assignment = await assignmentModel.findById(submission.assignmentId).select('createdBy').lean();
    let isAuthorized = user._id.equals(submission.studentId) || (isteacher?.teacher === true && assignment?.createdBy.equals(user._id));
    
    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
    
    // FIX: This single line replaces all manual S3 and DB cleanup.
    // It triggers the pre('deleteOne') hook in the submittedAssignmentSchema.
    await submission.deleteOne();

    res.status(200).json({ message: "Submission deleted successfully." });
});