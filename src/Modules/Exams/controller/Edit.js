import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";
import { PutObjectCommand, GetObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { s3 } from "../../../utils/S3Client.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { deleteFileFromS3, uploadFileToS3 } from "../../../utils/S3Client.js";

import fs from 'fs'; 
import { promises as fsPromises } from 'fs';
import { canAccessContent } from "../../../middelwares/contentAuth.js";


const authorizeExamDownload = asyncHandler(async (req, res, next) => {
    const { examId } = req.query;

    const hasAccess = await canAccessContent({
        user: { _id: req.user._id, isTeacher: req.isteacher.teacher },
        contentId: examId,
        contentType: 'exam'
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to access this exam.", { cause: 403 }));
    }

    // If access is granted, attach the exam to the request for the next middleware.
    req.exam = await examModel.findById(examId).select('bucketName key Name startdate enddate').lean();
    if (!req.exam) {
        return next(new Error("Exam not found.", { cause: 404 }));
    }

    next();
});

// The file streaming logic remains the same.
const streamExamFile = asyncHandler(async (req, res, next) => {
    const { bucketName, key, Name } = req.exam;

    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const s3Response = await s3.send(command);

    const safeFilename = encodeURIComponent(Name.replace(/[^a-zA-Z0-9.\-_]/g, '_') + '.pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Type', s3Response.ContentType || "application/pdf");
    if(s3Response.ContentLength) {
        res.setHeader('Content-Length', s3Response.ContentLength);
    }
    s3Response.Body.pipe(res);
});

const validateExamId = (req, res, next) => {
    const { examId } = req.query;
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        return next(new Error("A valid Exam ID is required.", { cause: 400 }));
    }
    next();
};

// --- PHASE 3: The final, updated export using the new authorization middleware ---
export const downloadExam = [
    validateExamId,
    authorizeExamDownload, // Replaces the old authorizeAndEnrollUser
    streamExamFile,
];






export const downloadSubmittedExam = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Input Validation ---
    const { submissionId } = req.query;
    const { user, isteacher } = req;

    if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    // --- Phase 2: Data Fetching ---
    // Fetch the submission. No need to populate as the authorization logic is simpler now.
    // Use .lean() for a fast, read-only query since we don't need a full Mongoose document.
    const submission = await SubexamModel.findById(submissionId).lean();

    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // --- Phase 3: Robust Authorization (Implementing Your Business Rule) ---
    if (isteacher?.teacher !== true) {
        // If the user is NOT a teacher, they must be the owner of the submission.
        if (!submission.studentId.equals(user._id)) {
            return next(new Error("You are not authorized to access this submission.", { cause: 403 }));
        }
    }
    // If we reach here, the user is either a teacher (who can access anything)
    // or the student who owns the submission. Access is granted.

    // --- Phase 4: S3 File Streaming ---
    const { fileBucket, fileKey } = submission;

    // Pre-flight check: Ensure there is actually a file to download.
    if (!fileBucket || !fileKey) {
        return next(new Error("This submission record has no associated file, it may have been corrupted or uploaded incorrectly.", { cause: 404 }));
    }

    try {
        const command = new GetObjectCommand({
            Bucket: fileBucket,
            Key: fileKey,
        });

        const s3Response = await s3.send(command);

        // Sanitize filename to prevent security vulnerabilities and ensure compatibility.
        const originalFilename = fileKey.split("/").pop() || 'submission.pdf';
        const safeFilename = encodeURIComponent(originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '_'));

        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
        res.setHeader('Content-Type', s3Response.ContentType || "application/octet-stream"); // Fallback MIME type
        if (s3Response.ContentLength) {
            res.setHeader('Content-Length', s3Response.ContentLength);
        }

        s3Response.Body.pipe(res);
        
    } catch (error) {
        console.error("Error fetching submitted exam from S3:", error);
        
        // Provide a more specific error to the client if the file doesn't exist on S3
        if (error.name === 'NoSuchKey') {
            return next(new Error("The submitted file could not be found in storage.", { cause: 404 }));
        }
        
        // For all other S3 errors (AccessDenied, etc.), return a generic server error.
        return next(new Error("Failed to download the submitted exam due to a storage error.", { cause: 500 }));
    }
});





export const markSubmissionWithPDF = asyncHandler(async (req, res, next) => {
  const { submissionId, score, feedback } = req.body;

  // 1. Validate submissionId
  if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
    return next(new Error("Valid submissionId is required", { cause: 400 }));
  }

  // 2. Check file
  if (!req.file) {
    return next(new Error("Please upload the marked PDF file", { cause: 400 }));
  }

  // 3. Find the existing submission
  const subExam = await SubexamModel.findById(submissionId);
  if (!subExam) {
    return next(new Error("Submission not found", { cause: 404 }));
  }

  // 4. Delete old PDF from S3 (optional but likely desired)
  //    so we don't keep the student's original or cause confusion.
  if (subExam.fileBucket && subExam.fileKey) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: subExam.fileBucket,
          Key: subExam.fileKey,
        })
      );
    } catch (delErr) {
      console.error("Error deleting old PDF:", delErr);
      // Not critical enough to stop the process
    }
  }

  // 5. Upload new PDF (the "marked" version) to S3
  let newKey;
  try {
    // The synchronous 'fs' is correctly used here, so no change is needed.
    const fileContent = fs.readFileSync(req.file.path);
    newKey = `MarkedSubmissions/${submissionId}_${Date.now()}.pdf`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: newKey,
        Body: fileContent,
        ContentType: "application/pdf",
        ACL: "private",
      })
    );
    // The synchronous 'fs' is correctly used here, so no change is needed.
    fs.unlinkSync(req.file.path);
  } catch (err) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return next(new Error("Error uploading marked PDF to S3", { cause: 500 }));
  }

  // 6. Overwrite the subexam doc with new PDF fields + new score/feedback
  subExam.fileBucket = process.env.S3_BUCKET_NAME;
  subExam.fileKey = newKey;
  subExam.filePath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${newKey}`;

  // score and feedback
  if (typeof score !== "undefined") {
    subExam.score = score;
  }
  if (typeof feedback !== "undefined") {
    subExam.teacherFeedback = feedback;
  }

  // 7. Save and return updated submission
  const updatedSubmission = await subExam.save();
  return res.status(200).json({
    message: "Marked PDF uploaded successfully",
    submission: updatedSubmission,
  });
});



export const addExceptionStudent = asyncHandler(async (req, res, next) => {
  const { examId, studentId, startdate, enddate } = req.body;

  // 1. Validate input
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("Valid examId is required", { cause: 400 }));
  }
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    return next(new Error("Valid studentId is required", { cause: 400 }));
  }
  if (!startdate || !enddate) {
    return next(new Error("startdate and enddate are required", { cause: 400 }));
  }
  if (new Date(startdate) >= new Date(enddate)) {
    return next(
      new Error("Exception startdate must be before enddate", { cause: 400 })
    );
  }

  // 2. Find the exam
  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  // 3. Check for conflicts
  const isRejected = exam.rejectedStudents.some(
    (sid) => sid.toString() === studentId
  );
  if (isRejected) {
    return next(
      new Error(
        "Cannot add to exception: student is already in rejectedStudents",
        { cause: 400 }
      )
    );
  }

  const isAlreadyInException = exam.exceptionStudents.some(
    (ex) => ex.studentId.toString() === studentId
  );
  if (isAlreadyInException) {
    return next(
      new Error("Student is already in exceptionStudents", { cause: 400 })
    );
  }

  // 4. Add the student to exceptionStudents
  //    We do NOT remove them from enrolled if they are in it. 
  exam.exceptionStudents.push({
    studentId: new mongoose.Types.ObjectId(studentId),
    startdate: new Date(startdate),
    enddate: new Date(enddate),
  });

  // 5. Save and return
  const updatedExam = await exam.save();

  return res.status(200).json({
    message: "Student added to exception successfully",
    exam: updatedExam,
  });
});

export const addRejectedStudent = asyncHandler(async (req, res, next) => {
  const { examId, studentId } = req.body;

  // 1. Validate input
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("Valid examId is required", { cause: 400 }));
  }
  if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
    return next(new Error("Valid studentId is required", { cause: 400 }));
  }

  // 2. Find the exam
  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  // 3. Check for conflicts
  //    If they are in exception, we throw an error
  const isInException = exam.exceptionStudents.some(
    (ex) => ex.studentId.toString() === studentId
  );
  if (isInException) {
    return next(
      new Error(
        "Cannot reject student: student is already in exceptionStudents",
        { cause: 400 }
      )
    );
  }

  const isAlreadyRejected = exam.rejectedStudents.some(
    (sid) => sid.toString() === studentId
  );
  if (isAlreadyRejected) {
    return next(
      new Error("Student is already in rejectedStudents", { cause: 400 })
    );
  }

  // 4. Remove student from enrolled if found
  //    to ensure no conflict
  const enrolledIndex = exam.enrolledStudents.findIndex(
    (sid) => sid.toString() === studentId
  );
  if (enrolledIndex !== -1) {
    exam.enrolledStudents.splice(enrolledIndex, 1);
  }

  // 5. Add student to rejected
  exam.rejectedStudents.push(new mongoose.Types.ObjectId(studentId));

  // 6. Save and return
  const updatedExam = await exam.save();

  return res.status(200).json({
    message: "Student added to rejected successfully",
    exam: updatedExam,
  });
});

export const deleteExam = asyncHandler(async (req, res, next) => {
  const { examId } = req.body;

  // 1. Validate input - This remains the same.
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("A valid examId is required", { cause: 400 }));
  }

  // 2. Find the specific exam document.
  // We need the document itself so we can call .deleteOne() on it, which
  // is what triggers your 'pre("deleteOne")' DOCUMENT middleware.
  const exam = await examModel.findById(examId);

  // 3. Handle case where exam doesn't exist.
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  // 4. Trigger the deletion. The middleware you wrote does ALL the heavy lifting.
  // This single line will automatically:
  // - Find all related submissions
  // - Delete all their associated files from S3
  // - Delete the submission records from the database
  // - Delete the main exam file from S3
  // - Finally, delete the exam record itself
  await exam.deleteOne();

  // 5. Send the success response.
  res.status(200).json({ message: "Exam and its submissions deleted successfully" });
});




export const deleteSubmittedExam = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Input Validation (Correct and unchanged) ---
    const { submissionId } = req.body;
    const { user, isteacher } = req;

    if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    // --- Phase 2: Fetch the Full Mongoose Document ---
    // We REMOVE .lean() because we need the document instance with its methods (like .deleteOne()).
    const submission = await SubexamModel.findById(submissionId);
    
    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // --- Phase 3: Authorization (Correct and unchanged) ---
    // This logic works perfectly on the full document.
    let isAuthorized = false;
    if (isteacher?.teacher === true) {
        isAuthorized = true;
    } else if (user._id.equals(submission.studentId)) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
    
    // --- Phase 4: Trigger Middleware and Delete ---
    // This single line replaces the entire transaction and manual S3 cleanup block.
    // It will trigger your pre('deleteOne') hook, which handles the S3 file deletion
    // before the document is removed from the database.
    await submission.deleteOne();

    // --- Phase 5: Send Success Response ---
    res.status(200).json({ message: "Submission deleted successfully." });
});