import { asyncHandler } from "../../../utils/erroHandling.js";
import { s3, uploadFileToS3, deleteFileFromS3 } from "../../../utils/S3Client.js";
import { groupModel } from "../../../../DB/models/groups.model.js";
import { gradeModel} from "../../../../DB/models/grades.model.js";
import {examModel} from "../../../../DB/models/exams.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import mongoose from "mongoose";
import studentModel from "../../../../DB/models/student.model.js";
import { promises as fs } from 'fs';
import slugify from "slugify";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";


const propagateExamToStreams = async ({ exam, session }) => {
    // 1. Find all students in the targeted groups
    const students = await studentModel.find({ groupId: { $in: exam.groupIds } }).select('_id groupId').session(session);
    if (students.length === 0) return;

    // 2. Prepare the ContentStream entries
    const streamEntries = students.map(student => ({
        userId: student._id,
        contentId: exam._id,
        contentType: 'exam',
        gradeId: exam.grade, // Note: field is 'grade' in exam model
        groupId: student.groupId
    }));

    // 3. Prepare the SubmissionStatus entries
    const statusEntries = students.map(student => ({
        studentId: student._id,
        contentId: exam._id,
        contentType: 'exam',
        submissionModel: 'subexam',
        groupId: student.groupId,
        status: 'assigned'
    }));

    // 4. Give the creator access
    streamEntries.push({
        userId: exam.createdBy,
        contentId: exam._id,
        contentType: 'exam',
        gradeId: exam.grade
    });

    // 5. Insert all records
    await Promise.all([
        contentStreamModel.insertMany(streamEntries, { session }),
        submissionStatusModel.insertMany(statusEntries, { session })
    ]);
};

export const createExam = asyncHandler(async (req, res, next) => {
       const examFile = req.files?.file?.[0];
    const answerFile = req.files?.answerFile?.[0];

    if (!examFile) {
        // If other files were uploaded, clean them up
        if (answerFile?.path) await fs.unlink(answerFile.path);
        return next(new Error("The main exam file is required.", { cause: 400 }));
    }

    const newExam = await _internalCreateExam({
        ...req.validatedData,
        Name: req.validatedData.name, // Map `name` to `Name` for the internal function
        startdate: req.validatedData.startDate,
        enddate: req.validatedData.endDate,
        file: examFile, // Pass the main file object
        teacherId: req.user._id,
                answerFile: answerFile, // Pass the optional answer file object

    });
    res.status(201).json({ message: "Exam created successfully", exam: newExam });
});
export const _internalCreateExam = async ({ Name, startdate, enddate, gradeId, groupIds, file, teacherId, exceptionStudents, allowSubmissionsAfterDueDate,answerFile }) => {
    const name = Name.trim();
    const slug = slugify(name, { lower: true, strict: true });
    const s3Key = `exams/${slug}-${Date.now()}.pdf`;
  const s3AnswerKey = answerFile ? `exams/answers/${slug}-answer-${Date.now()}.pdf` : null;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const fileContent = await fs.readFile(file.path);
        if (fileContent.length === 0) throw new Error("Cannot create an exam with an empty file.");
            const examData = {
            Name: Name,
            slug,
            startdate,
            enddate,
            grade: gradeId,
            groupIds,
            bucketName: process.env.S3_BUCKET_NAME,
            key: s3Key,
            path: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            createdBy: teacherId,
            exceptionStudents,
            allowSubmissionsAfterDueDate: allowSubmissionsAfterDueDate || false,
        };

         let answerFileContent = null;
        if (answerFile && s3AnswerKey) {
            answerFileContent = await fs.readFile(answerFile.path);
            if (answerFileContent.length === 0) throw new Error("The answer file cannot be empty.");
            examData.answerBucketName = process.env.S3_BUCKET_NAME;
            examData.answerKey = s3AnswerKey;
            examData.answerPath = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3AnswerKey}`;
        }
        


         const [newExam] = await examModel.create([examData], { session });
await propagateExamToStreams({ exam: newExam, session });
        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");
        if (answerFile && s3AnswerKey && answerFileContent) {
            await uploadFileToS3(process.env.S3_BUCKET_NAME, s3AnswerKey, answerFileContent, "application/pdf");
        }
        await session.commitTransaction();
        return newExam;

    } catch (error) {
         await session.abortTransaction();
        // If anything went wrong, attempt to clean up any files that might have been uploaded to S3.
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(s3Err => console.error("S3 exam file rollback failed:", s3Err));
        if (s3AnswerKey) {
            await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3AnswerKey).catch(s3Err => console.error("S3 answer file rollback failed:", s3Err));
        }
        throw error; 
    } finally {
      await session.endSession();
        // Always clean up the local temporary files.
        if (file?.path) {
            await fs.unlink(file.path).catch(e => console.error(`Failed to delete temp file: ${file.path}`, e));
        }
        if (answerFile?.path) {
            await fs.unlink(answerFile.path).catch(e => console.error(`Failed to delete temp file: ${answerFile.path}`, e));
        }
    }
};



export const submitExam = asyncHandler(async (req, res, next) => {
    const { examId, notes } = req.body;
    const { user, isteacher } = req;

    // 1. Initial Validation
    if (isteacher) {
        return next(new Error("Teachers are not permitted to submit exams.", { cause: 403 }));
    }
    if (!req.file) {
        return next(new Error("A file must be attached for submission.", { cause: 400 }));
    }
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
        await fs.unlink(req.file.path);
        return next(new Error("A valid Exam ID is required.", { cause: 400 }));
    }

    // =================================================================
    // --- PHASE 2: Refactor Authorization Logic ---
    // =================================================================
    // We now use our universal authorizer to check if the student can access this exam.
    // This replaces the large, complex, and redundant inline authorization block.
   const hasAccess = await canAccessContent({
        user: user,
        isTeacher: isteacher,
        contentId: examId,
        contentType: 'exam'
    });
    // --- END REFACTOR ---

    // 2. Fetch necessary data (exam and file content)
    const [exam, fileContent] = await Promise.all([
        examModel.findById(examId),
        fs.readFile(req.file.path)
    ]);

    if (!exam) { await fs.unlink(req.file.path); return next(new Error("Exam not found.", { cause: 404 })); }
    if (fileContent.length === 0) { await fs.unlink(req.file.path); return next(new Error("Cannot submit an empty file.", { cause: 400 })); }

    // 3. Timeline and Late Submission Check
    const uaeTimeZone = 'Asia/Dubai';
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const exceptionEntry = exam.exceptionStudents.find(ex => ex.studentId.equals(user._id));
    
    const effectiveEndDate = exceptionEntry ? exceptionEntry.enddate : exam.enddate;
    const isLate = submissionTime > effectiveEndDate;

    if (isLate && !exam.allowSubmissionsAfterDueDate) {
        await fs.unlink(req.file.path);
        const reason = exceptionEntry ? "your special time window has closed" : "the submission deadline has passed";
        return next(new Error(`Cannot submit because ${reason}.`, { cause: 403 }));
    }

    // 4. Prepare and execute the submission transaction
    const s3Key = `ExamSubmissions/${examId}/${user._id}_${submissionTime.getTime()}.pdf`;
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const currentVersionCount = await SubexamModel.countDocuments({ examId, studentId: user._id }).session(session);
        const newVersion = currentVersionCount + 1;


        await submissionStatusModel.updateOne(
            { studentId: user._id, contentId: examId, contentType: 'exam' },
            { 
                status: 'submitted', 
                submissionId: newSubmission._id,
                isLate: isLate,
                SubmitDate: submissionTime
            },
            { session }
        );

        await uploadFileToS3(process.env.S3_BUCKET_NAME, s3Key, fileContent, "application/pdf");

        const [newSubmission] = await SubexamModel.create([{
            examId, studentId: user._id, version: newVersion, examname: exam.Name,
            SubmitDate: submissionTime, notes: notes?.trim() || "",
            fileBucket: process.env.S3_BUCKET_NAME, fileKey: s3Key,
            filePath: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
            isLate: isLate
        }], { session });

        await session.commitTransaction();
        res.status(200).json({ message: "Exam submitted successfully.", submission: newSubmission });

    } catch (error) {
        await session.abortTransaction();
        await deleteFileFromS3(process.env.S3_BUCKET_NAME, s3Key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
        await fs.unlink(req.file.path);
    }
});