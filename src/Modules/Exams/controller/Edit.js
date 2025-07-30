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
import { sectionModel } from "../../../../DB/models/section.model.js";

const validateExamId = (req, res, next) => {
    const { examId } = req.query;
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        return next(new Error("A valid Exam ID is required.", { cause: 400 }));
    }
    next();
};

const authorizeExamDownload = asyncHandler(async (req, res, next) => {
    const { examId } = req.query;

    const hasAccess = await canAccessContent({
        user: req.user,
        isTeacher: req.isteacher.teacher,
        contentId: examId,
        contentType: 'exam'
    });

    if (!hasAccess) {
        return next(new Error("You are not authorized to access this exam.", { cause: 403 }));
    }

    req.exam = await examModel.findById(examId).select('bucketName key Name').lean();
    if (!req.exam) {
        return next(new Error("Exam not found.", { cause: 404 }));
    }

    // =================================================================
    // --- FINAL PERFECTION: Add a robust pre-flight check for S3 data ---
    // =================================================================
    // Before proceeding, we MUST ensure the document has the required S3 info.
    if (!req.exam.bucketName || !req.exam.key) {
        console.error(`Data integrity error: Exam ${req.exam._id} is missing S3 bucketName or key.`);
        return next(new Error("Cannot download file: The resource is not correctly linked to storage.", { cause: 500 }));
    }
    // --- END FIX ---

    next();
});

const streamExamFile = asyncHandler(async (req, res, next) => {
    // Because of the pre-flight check above, we can now be certain that bucketName and key exist.
    const { bucketName, key, Name } = req.exam;
    
    try {
        const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
        const s3Response = await s3.send(command);

        const safeFilename = encodeURIComponent(Name.replace(/[^a-zA-Z0-9.\-_]/g, '_') + '.pdf');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
        res.setHeader('Content-Type', s3Response.ContentType || "application/pdf");
        if (s3Response.ContentLength) {
            res.setHeader('Content-Length', s3Response.ContentLength);
        }
        s3Response.Body.pipe(res);
    } catch (error) {
        // This will now only catch genuine S3 errors (like file actually deleted)
        // rather than errors from our own bad data.
        console.error(`S3 File Streaming Error for key ${key}:`, error);
        return next(new Error("Failed to download the exam file from storage.", { cause: 500 }));
    }
});

export const downloadExam = [
    validateExamId,
    authorizeExamDownload,
    streamExamFile,
];

export const editExam = asyncHandler(async (req, res, next) => {
    const { examId, ...updateData } = req.body;
    const teacherId = req.user._id;

    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        return next(new Error("A valid Exam ID is required.", { cause: 400 }));
    }

    const exam = await examModel.findById(examId);
    if (!exam) {
        return next(new Error("Exam not found.", { cause: 404 }));
    }

    if (!exam.createdBy.equals(teacherId)) {
        return next(new Error("You are not authorized to edit this exam.", { cause: 403 }));
    }

    if (req.file) {
        if (exam.key) {
            await deleteFileFromS3(exam.bucketName, exam.key)
                .catch(err => console.error("Non-critical error: Failed to delete old S3 file during edit:", err));
        }
        
        // Use the aliased 'fsPromises' for async operations
        const fileContent = await fsPromises.readFile(req.file.path);
        const newKey = `exams/${exam.Name.replace(/\s+/g, '_')}-${Date.now()}.pdf`;
        
        await uploadFileToS3(process.env.S3_BUCKET_NAME, newKey, fileContent, "application/pdf");
        
        exam.key = newKey;
        exam.path = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${newKey}`;
        exam.bucketName = process.env.S3_BUCKET_NAME;

        // Use the aliased 'fsPromises' for async operations
        await fsPromises.unlink(req.file.path);
    }
    
    // Sanitize and update name if provided
    if (updateData.Name) {
        updateData.Name = updateData.Name.trim();
    }
    
    Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined && updateData[key] !== null) {
            exam[key] = updateData[key];
        }
    });

    const updatedExam = await exam.save();

    res.status(200).json({
        message: "Exam updated successfully.",
        exam: updatedExam,
    });
});




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
    const { bucketName, key } = submission;

    // Pre-flight check: Ensure there is actually a file to download.
    if (!fileBucket || !key) {
        return next(new Error("This submission record has no associated file, it may have been corrupted or uploaded incorrectly.", { cause: 404 }));
    }

  return res.status(200).json({
    message: "Marked PDF Downloaded successfully",
    submission: submission,
  });
});





export const markSubmissionWithPDF = asyncHandler(async (req, res, next) => {
  const { submissionId, score, feedback ,annotationData} = req.body;

  // 1. Validate submissionId
  if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
    return next(new Error("Valid submissionId is required", { cause: 400 }));
  }



  // 3. Find the existing submission
  const subExam = await SubexamModel.findById(submissionId);
  if (!subExam) {
    return next(new Error("Submission not found", { cause: 404 }));
  }


 
 
  // 6. Overwrite the subexam doc with new PDF fields + new score/feedback
  subExam.bucketName ;
  subExam.key ;
  subExam.path ;

  // score and feedback
  if (typeof score !== "undefined") {
    subExam.score = score;
  }
  if (typeof feedback !== "undefined") {
    subExam.teacherFeedback = feedback;
  }
 if (typeof annotationData !== "undefined") {
    subExam.annotationData = annotationData;
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