import path from 'path';
import slugify from "slugify";
import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import {  deleteFileFromS3 } from "../../../utils/S3Client.js";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import mongoose from "mongoose";
import { toZonedTime } from 'date-fns-tz';
import { canAccessContent } from '../../../middelwares/contentAuth.js';
import { contentStreamModel } from "../../../../DB/models/contentStream.model.js";
import { submissionStatusModel } from "../../../../DB/models/submissionStatus.model.js";
import { synchronizeContentStreams } from '../../../utils/streamHelpers.js';

const propagateAssignmentToStreams = async ({ assignment, session }) => {
   
    await synchronizeContentStreams({
        content: assignment,
        oldGroupIds: [], // There are no old groups on creation
        newGroupIds: assignment.groupIds,
        session
    });

   
    await contentStreamModel.updateOne(
        { userId: assignment.createdBy, contentId: assignment._id },
        { 
            $set: { contentType: 'assignment' },
        },
        { upsert: true, session }
    );
};
export const _internalCreateAssignment =async ({ name, startDate, endDate, groupIds, teacherId, allowSubmissionsAfterDueDate, teacherNotes, mainFile, answerFile }) => {
          const slug =mainFile? slugify(name, { lower: true, strict: true }):null;

         const session = await mongoose.startSession();

    try {
                session.startTransaction();
   const assignmentData = {
            name, slug, startDate, endDate, groupIds,
            allowSubmissionsAfterDueDate: allowSubmissionsAfterDueDate || false,
            createdBy: teacherId,
            
        };
   
        if(mainFile){
            assignmentData.bucketName= mainFile.bucket;
             assignmentData.key= mainFile.key;
             assignmentData.path= mainFile.location
        }else{
            assignmentData.teacherNotes= teacherNotes

        }
        if (answerFile) {
            assignmentData.answerBucketName = answerFile.bucket;
            assignmentData.answerKey = answerFile.key;
            assignmentData.answerPath = answerFile.location;
        }
        
    const [newAssignment] = await assignmentModel.create([assignmentData], { session });
        await propagateAssignmentToStreams({ assignment: newAssignment, session });

        await session.commitTransaction();
        return newAssignment;

     


    } catch (err) {
        await session.abortTransaction();
        // S3 Rollback: If DB fails, delete the files that multer-s3 already uploaded.
        if (mainFile) await deleteFileFromS3(mainFile.bucket, mainFile.key).catch(e => console.error("S3 assignment file rollback failed:", e));
        if (answerFile) await deleteFileFromS3(answerFile.bucket, answerFile.key).catch(e => console.error("S3 answer file rollback failed:", e));
        throw err;

    } finally {
         await session.endSession();
      
    }
};

export const CreateAssignment = asyncHandler(async (req, res, next) => {
    const mainFile = req.files?.file?.[0];
    const answerFile = req.files?.answerFile?.[0];
    const {teacherNotes} = req.body;
 if (!mainFile && !teacherNotes) {
        return next(new Error("The assignment file or notes is required.", { cause: 400 }));
    }
  
const newAssignment = await _internalCreateAssignment({
        ...req.validatedData,
        teacherId: req.user._id,
        mainFile,
        answerFile,
    });
    res.status(201).json({ message: "Assignment created successfully", assignment: newAssignment });
});


export const submitAssignment = asyncHandler(async (req, res, next) => {
    const { assignmentId, notes } = req.body; // No groupId from frontend
    const { user, isteacher } = req;

    if (!req.file) return next(new Error("A file must be attached for submission.", { cause: 400 }));
    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) return next(new Error("A valid assignmentId is required.", { cause: 400 }));
    
    const hasAccess = await canAccessContent({ user, isTeacher: isteacher, contentId: assignmentId, contentType: 'assignment' });
    if (!hasAccess) return next(new Error("You are not authorized to submit to this assignment.", { cause: 403 }));

    const [assignment, student] = await Promise.all([
       assignmentModel.findById(assignmentId).select('name groupIds endDate allowSubmissionsAfterDueDate').lean(),
        studentModel.findById(user._id).select('groupIds').lean(),
    ]);
    
    if (!assignment) { return next(new Error("Assignment not found.", { cause: 404 })); }
    if (!student) { return next(new Error("Student not found.", { cause: 404 })); }

    const commonGroupIds = student.groupIds.filter(sgid => 
        assignment.groupIds.some(agid => agid.equals(sgid))
    );

    if (commonGroupIds.length === 0) {
        return next(new Error("Submission context is invalid. You do not share a group with this assignment.", { cause: 403 }));
    }
    if (commonGroupIds.length > 1) {
        return next(new Error("Ambiguous submission context: This assignment exists in multiple groups you belong to. Please contact your teacher to resolve this.", { cause: 409 })); // 409 Conflict is appropriate here
    }
    const determinedGroupId = commonGroupIds[0]; // This is the one, unambiguous group
    // --- End of Logic ---

    const uaeTimeZone = 'Asia/Dubai';
    const submissionTime = toZonedTime(new Date(), uaeTimeZone);
    const isLate = submissionTime > new Date(assignment.endDate);

    if (isLate && !assignment.allowSubmissionsAfterDueDate) {
        return next(new Error("Cannot submit because the deadline has passed.", { cause: 403 }));
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const currentVersionCount = await SubassignmentModel.countDocuments({ studentId: user._id, assignmentId, groupId: determinedGroupId }).session(session);
        const newVersion = currentVersionCount + 1;

        const [newSubmission] = await SubassignmentModel.create([{
            studentId: user._id, assignmentId, version: newVersion,
            assignmentname: assignment.name,
            groupId: determinedGroupId, // Use the auto-detected group ID
            SubmitDate: submissionTime,
            notes: notes?.trim() || (isLate ? "Submitted late" : "Submitted on time"),
            isLate, 
            bucketName: req.file.bucket,
            key: req.file.key,
            path: req.file.location,
        }], { session });

        await submissionStatusModel.updateOne(
            { studentId: user._id, contentId: assignmentId, groupId: determinedGroupId },
            { $set: { status: 'submitted', submissionId: newSubmission._id, isLate, SubmitDate: submissionTime, submissionModel: 'subassignment' }},
            { session, upsert: true }
        );

        await session.commitTransaction();
        // NO CHANGE IN RESPONSE STRUCTURE
        res.status(200).json({ message: "Assignment submitted successfully.", submission: newSubmission });

    } catch (error) {
        await session.abortTransaction();
        await deleteFileFromS3(req.file.bucket, req.file.key).catch(e => console.error("S3 rollback failed:", e));
        return next(new Error("Failed to save submission. The operation was rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
    }
});