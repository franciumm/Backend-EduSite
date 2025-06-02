import { asyncHandler } from "../../../utils/erroHandling.js";
import { examModel } from "../../../../DB/models/exams.model.js";
import { PutObjectCommand, GetObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { s3 } from "../../../utils/S3Client.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import fs from 'fs'



// 1. الدالة دي مش محتاجة ترجّع Promise، فمش هنغلفها بـ asyncHandler
const validateExamId = (req, res, next) => {
  const { examId } = req.query;
  if (!examId) {
    return next(new Error("Exam ID is required", { cause: 400 }));
  }
  next();
};

// 2. دالة صلاحيات الطالب/المدرس لحد دلوقتي async، يبقى هنا نستخدم asyncHandler عادي
const authorizeUserForExam = async (req, res, next) => {
  const { examId } = req.query;
  const exam = await examModel.findById(examId);
  if (!exam) {
    return next(new Error("Exam not found", { cause: 404 }));
  }

  // لو teacher، نفترض إنه عنده صلاحية تلقائية
  if (req.isteacher?.teacher) {
    req.exam = exam;
    return next();
  }

  // لو student، نتحقق من المجموعات والتسجيل والـ exceptions
  const studentId = req.user._id.toString();
  const studentGroupId = req.user.groupid?.toString();

  const isInGroup = exam.groupIds.some((gid) => gid.toString() === studentGroupId);
  const isEnrolled = exam.enrolledStudents.some((sid) => sid.toString() === studentId);
  const isRejected = exam.rejectedStudents.some((sid) => sid.toString() === studentId);
  const exceptionEntry = exam.exceptionStudents.find((ex) => ex.studentId.toString() === studentId);

  if (isRejected || (!isInGroup && !isEnrolled && !exceptionEntry)) {
    return next(new Error("You are not authorized to access this exam.", { cause: 403 }));
  }

  // نتحقق من التايملاين (أساسي أو استثناء)
  const now = new Date();
  if (exceptionEntry) {
    if (now < exceptionEntry.startdate || now > exceptionEntry.enddate) {
      return next(new Error("This exam is not available (exception timeline).", { cause: 403 }));
    }
  } else {
    if (now < exam.startdate || now > exam.enddate) {
      return next(new Error("This exam is not available (main timeline).", { cause: 403 }));
    }
  }

  // لو مش مسجل أصلاً، نضيفه لقائمة المسجلين
  if (!isEnrolled) {
    exam.enrolledStudents.push(req.user._id);
    await exam.save();
  }

  req.exam = exam;
  next();
};

// 3. دالة تنزيل الملف من S3، بردو async معمولها wrap بالـ asyncHandler
const streamExamFile = async (req, res, next) => {
  const exam = req.exam;
  const { bucketName, key } = exam;

  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3.send(command);

    const filename = key.split("/").pop();
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.setHeader("Content-Type", response.ContentType || "application/pdf");

    response.Body.pipe(res);

    response.Body.on("end", async () => {
      if (!req.isteacher?.teacher) {
        const stillEnrolled = exam.enrolledStudents.some(
          (sid) => sid.toString() === req.user._id.toString()
        );
        if (!stillEnrolled) {
          exam.enrolledStudents.push(req.user._id);
          await exam.save();
        }
      }
    });
  } catch (err) {
    console.error("S3 Error:", err);
    return next(new Error("Failed to download the exam file.", { cause: 500 }));
  }
};

// 4. نصدّر الـ middleware محتوية على الثلاث مراحل بدون تغليف validateExamId بالـ asyncHandler
export const downloadExam = [
  validateExamId,
  asyncHandler(authorizeUserForExam),
  asyncHandler(streamExamFile),
];

export const downloadSubmittedExam = asyncHandler(async (req, res, next) => {
  const { submissionId } = req.query;

  // 1. Validate submission ID
  if (!submissionId) {
    return next(new Error("Submission ID is required", { cause: 400 }));
  }

  // 2. Fetch the submitted exam details
  const submission = await SubexamModel.findById(submissionId).populate("examId");
  if (!submission) {
    return next(new Error("Submitted exam not found", { cause: 404 }));
  }

  const exam = submission.examId;

  // 3. If user is a teacher, allow access to the submitted exam
  if (req.isteacher.teacher) {
    // Teachers can access any submitted exam without further checks
  } else {
    // 4. For students, ensure they are the one who submitted it
    if (submission.studentId.toString() !== req.user._id.toString()) {
      return next(new Error("You are not authorized to access this submission.", { cause: 403 }));
    }

    // 5. Timeline check (only for the main exam timeline or exception)
    const now = new Date();
    const exceptionEntry = exam.exceptionStudents.find(
      (ex) => ex.studentId.toString() === req.user._id.toString()
    );

    const examStart = exceptionEntry ? exceptionEntry.startdate : exam.startdate;
    const examEnd = exceptionEntry ? exceptionEntry.enddate : exam.enddate;

    if (now < examStart || now > examEnd) {
      return next(new Error("This submission is not available at the moment.", { cause: 403 }));
    }
  }

  // 6. Fetch the submitted exam file from S3
  const { fileBucket: bucketName, fileKey: key } = submission;
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3.send(command);

    // 7. Set headers for file download
    const filename = key.split("/").pop(); // Extract filename from the S3 key
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", response.ContentType);

    // 8. Stream the file to the response
    response.Body.pipe(res);
  } catch (error) {
    console.error("Error fetching submitted exam from S3:", error);
    return next(new Error("Failed to download the submitted exam.", { cause: 500 }));
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
