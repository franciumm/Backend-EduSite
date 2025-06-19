import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";
import { PutObjectCommand, GetObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { s3 } from "../../../utils/S3Client.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import fs from 'fs'
import studentModel from "../../../../DB/models/student.model.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';


const validateExamId = (req, res, next) => {
    const { examId } = req.query;
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) { // Added ObjectId validation
        return next(new Error("A valid Exam ID is required in the query.", { cause: 400 }));
    }
    next();
};

// --- 2. Authorization & Enrollment Middleware (Asynchronous & Optimized) ---

const authorizeAndEnrollUser = async (req, res, next) => {
    // --- SETUP ---
    const { examId } = req.query;
    const { user, isteacher } = req;
    const isTeacher = isteacher?.teacher === true;
    const uaeTimeZone = 'Asia/Dubai';

    const exam = await examModel.findById(examId);
    if (!exam) {
        return next(new Error("Exam not found.", { cause: 404 }));
    }

    if (isTeacher) {
        req.exam = exam;
        return next();
    }

    // --- STUDENT AUTHORIZATION (remains the same) ---
    const studentId = user._id;
    // ... (Your existing authorization logic for groups, rejections, etc.)
    const student = await studentModel.findById(user._id);
    user.groupId = student.groupId;
    const isInGroup = exam.groupIds.some(gid => gid.equals(user.groupId));
    if (!isInGroup) {
        return next(new Error("You are not in an authorized group for this exam.", { cause: 403 }));
    }

    // --- EXPLICIT UAE TIME ZONE CHECK ---

    // Step 1: Get the current time, explicitly represented as UAE time.
    const nowInUAE = toZonedTime(new Date(), uaeTimeZone);

    // Step 2: Get the exam's start and end times, also explicitly represented as UAE time.
    const examStartTimeInUAE = toZonedTime(exam.startdate, uaeTimeZone);
    const examEndTimeInUAE = toZonedTime(exam.enddate, uaeTimeZone);

    // Step 3: Compare the UAE times directly. This is now perfectly clear.
    if (nowInUAE < examStartTimeInUAE || nowInUAE > examEndTimeInUAE) {
        // The error message formatting remains the same and is already correct.
        const friendlyFormat = "eeee, MMMM d, yyyy 'at' h:mm a (z)";
        const friendlyStartDate = format(examStartTimeInUAE, friendlyFormat, { timeZone: uaeTimeZone });
        const friendlyEndDate = format(examEndTimeInUAE, friendlyFormat, { timeZone: uaeTimeZone });
        const errorMessage = `This exam is not available at this time. (Available from ${friendlyStartDate} to ${friendlyEndDate})`;
        
        return next(new Error(errorMessage, { cause: 403 }));
    }

    // --- ATOMIC ENROLLMENT (Remains the same) ---
    const updatedExam = await examModel.findByIdAndUpdate(
        examId,
        { $addToSet: { enrolledStudents: studentId } },
        { new: true }
    );

    req.exam = updatedExam;
    next();
};

// --- 3. File Streaming Middleware (Asynchronous) ---
// This logic is already well-designed. Minor improvements for clarity.
const streamExamFile = async (req, res, next) => {
    const exam = req.exam;

    // --- Data Integrity Check ---
    // Before we even try to call S3, verify that the required data exists.
    if (!exam || !exam.bucketName || !exam.key) {
        console.error("Data Integrity Error: Exam document is missing S3 bucketName or key.", { examId: exam._id });
        return next(new Error("Cannot download file: exam data is incomplete.", { cause: 500 }));
    }

    const { bucketName, key, Name } = req.exam;

    try {
        const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
        const s3Response = await s3.send(command);

        const safeFilename = encodeURIComponent(Name.replace(/[^a-zA-Z0-9.\-_]/g, '_') + '.pdf');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
        res.setHeader('Content-Type', s3Response.ContentType || "application/pdf");
 if(s3Response.ContentLength) {
             res.setHeader('Content-Length', s3Response.ContentLength);
        }
        s3Response.Body.pipe(res);
        
    } catch (err) {
        console.error("S3 File Streaming Error:", err);
        return next(new Error("Failed to download the exam file.", { cause: 500 }));
    }
};

// --- 4. Final Exported Pipeline ---
// The modular structure is excellent and is preserved.
export const downloadExam = [
    validateExamId,
    asyncHandler(authorizeAndEnrollUser),
    asyncHandler(streamExamFile),
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
  const { examId } = req.body; // or req.query, as you prefer

  // 1. Validate examId
  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return next(new Error("A valid examId is required", { cause: 400 }));
  }

  // 2. Find the exam
  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  try {
    // 3. Delete the exam's main file from S3
    if (exam.bucketName && exam.key) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: exam.bucketName,
          Key: exam.key,
        })
      );
    }

    // 4. Find all submissions for this exam
    const submissions = await SubexamModel.find({ examId });

    // 5. Delete each submission file from S3
    for (const submission of submissions) {
      if (submission.fileBucket && submission.fileKey) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: submission.fileBucket,
              Key: submission.fileKey,
            })
          );
        } catch (error) {
          console.error(`Error deleting submission file ${submission.fileKey}:`, error);
          // Not critical enough to stop the entire process
        }
      }
    }

    // 6. Delete all submission records for this exam
    await SubexamModel.deleteMany({ examId });

    // 7. Delete the exam record from the database
    await examModel.deleteOne({ _id: examId });

    // 8. Return success response
    res.status(200).json({
      message: "Exam and its submissions deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting exam or submissions:", error);
    return next(new Error("Failed to delete exam and its submissions", { cause: 500 }));
  }
});







export const deleteSubmittedExam = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Input Validation ---
    const { submissionId } = req.body;
    const { user, isteacher } = req;

    if (!submissionId || (!mongoose.Types.ObjectId.isValid(submissionId))) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    // --- Phase 2: Prepare - Data Fetching ---
    // Fetch the full submission document. We need its details for authorization and cleanup.
    // Use .lean() for a fast, read-only query.
    const submission = await SubexamModel.findById(submissionId).lean();
    
    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // --- Phase 3: Robust Authorization (Implementing Your Business Rules) ---
    let isAuthorized = false;
    // Condition 1: The user is a teacher. (Your rule: "any teacher can delete")
    if (isteacher?.teacher === true) {
        isAuthorized = true;
    }
    // Condition 2: The user is the student who made the submission.
    else if (user._id.equals(submission.studentId)) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
    
    // --- Phase 4: Execute - Atomic Database Transaction ---
    // The transaction is now extremely simple and fast, containing only one essential operation.
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        await SubexamModel.findByIdAndDelete(submission._id, { session });
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        console.error("Database transaction failed during submission deletion:", error);
        return next(new Error("Failed to delete submission due to a database error. Operation rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
    }

    // --- Phase 5: Post-Commit Cleanup - S3 Deletion ---
    // This runs only after the database transaction was successful, ensuring data integrity.
    if (submission.fileKey) {
        try {
            await s3.send(new DeleteObjectCommand({
                Bucket: submission.fileBucket,
                Key: submission.fileKey,
            }));
        } catch (s3Error) {
            // If the file is already gone, that's okay. Log other S3 errors as critical.
            if (s3Error.name !== 'NoSuchKey') {
                console.error(`CRITICAL: DB record for submission ${submission._id} was deleted, but S3 cleanup failed for key ${submission.fileKey}.`, s3Error);
            }
        }
    }

    res.status(200).json({ message: "Submission deleted successfully." });
});