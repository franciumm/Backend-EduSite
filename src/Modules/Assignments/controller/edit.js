import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand,DeleteObjectCommand,DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import { groupModel } from "../../../../DB/models/groups.model.js";
import studentModel from "../../../../DB/models/student.model.js";
import mongoose from "mongoose";
import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';

// export const downloadAssignment = asyncHandler(async (req, res, next) => {
//   const { assignmentId } = req.query;


//   // Fetch assignment details from the database
//   const assignment = await assignmentModel.findById(assignmentId);
//   if (!assignment) {
//     return next(new Error("Assignment not found", { cause: 404 }));
//   }
//   req.user.groupId =  await studentModel.findById(req.user._id).groupId;
//  if(req.isteacher.teacher == false && req.user.groupId != assignment.groupId)
//   {
//     next(new Error("Student not In same Group", { cause: 404 })); 
//   }
// // Extract S3 bucket name and file key
//   const { bucketName, key } = assignment;

//   try {
//     // Get the object from S3
//     const command = new GetObjectCommand({
//       Bucket: bucketName,
//       Key: key,
//     });

//     const response = await s3.send(command);

//     // Set headers for file download
//     res.setHeader("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
//     res.setHeader("Content-Type", response.ContentType);

//     // Pipe the file stream to the response
//     response.Body.pipe(res);
//   } catch (error) {
//     console.error("Error downloading file from S3:", error);
//     return next(new Error("Error downloading file from S3", { cause: 500 }));
//   }
// });



    export const downloadAssignment = asyncHandler(async (req, res, next) => {
  const { assignmentId } = req.query;

  // 1. Fetch assignment
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 2. Fetch student and get their group
  
  // 3. Check authorization
  const isTeacher = req.isteacher.teacher === true;
  if (!isTeacher) {
    var student = await studentModel.findById(req.user._id);
  
  if (!student) {
    return next(new Error("Student record not found", { cause: 404 }));
  }

    // FIX: Check if the student is assigned to a group BEFORE comparing IDs
    if (!student.groupId) {
      return next(new Error("You are not assigned to any group.", { cause: 403 }));
    }

    // Now it's safe to compare
    const studentGroupIdStr = student.groupId.toString();
// Convert the array of ObjectId to an array of strings for comparison
const assignmentGroupIdsStr = assignment.groupIds.map(id => id.toString());
    const now = new Date();
    const timeline = { start: assignment.startDate, end: assignment.endDate };
        
    if (now < timeline.start || now > timeline.end) {
        return next(new Error(`This Assignment is not available at this time. (Available from ${timeline.start.toLocaleString()} to ${timeline.end.toLocaleString()})`, { cause: 200 }));
    }

// FIX: Check if the student's group is in the assignment's list of allowed groups
if (!isTeacher && !assignmentGroupIdsStr.includes(studentGroupIdStr)) {
    return next(new Error("You’re not in the right group for this assignment", { cause: 403 }));
}
  }

  // 4. Proceed with S3 download
  const { bucketName, key } = assignment;
  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3.send(command);

    res.setHeader("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
    res.setHeader("Content-Type", response.ContentType);
    response.Body.pipe(res);
  } catch (error) {
    console.error("Error downloading file from S3:", error);
    next(new Error("Error downloading file from S3", { cause: 500 }));
  }
}


);

export const downloadSubmittedAssignment = asyncHandler(async (req, res, next) => {
  const { submissionId } = req.query;

  // Validate submissionId
  if (!submissionId) {
    return next(new Error("Submission ID is required", { cause: 400 }));
  }

  // Fetch the submission details
  const submission = await SubassignmentModel.findById(submissionId)
    .populate("assignmentId", "name") // Populate assignment name
    .populate("studentId", "userName firstName lastName"); // Populate student details

  if (!submission) {
    return next(new Error("Submission not found", { cause: 404 }));
  }

  // Validate access: Only the submitting student or the teacher can download
  if (
    req.isteacher.teacher === false && // If the user is a student
    submission.studentId._id.toString() !== req.user._id.toString() // Not the submitting student
  ) {
    return next(
      new Error("You are not allowed to download this submission", { cause: 403 })
    );
  }

  // Extract S3 bucket and file key
  const { bucketName, key } = submission;

  try {
    // Fetch the file from S3
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3.send(command);

    // Set headers for the file download
    const fileName = `${submission.assignmentId.name}_${submission.studentId.userName}.pdf`;
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", response.ContentType);

    // Stream the file to the response
    response.Body.pipe(res);
  } catch (error) {
    console.error("Error downloading the submission from S3:", error);
    return next(new Error("Error downloading the submission", { cause: 500 }));
  }
});


export const markAssignment = asyncHandler(async (req, res, next) => {
  const { submissionId, score, notes } = req.body;

  // Validate submission existence
  const submission = await SubassignmentModel.findById(submissionId).populate("assignmentId studentId");
  if (!submission) {
    return next(new Error("Submission not found", { cause: 404 }));
  }

  const { bucketName, key } = submission;

  // Ensure a marked file is uploaded
  if (!req.file) {
    return next(new Error("Please upload the marked PDF file", { cause: 400 }));
  }

  try {
    // Read the uploaded marked file
    const fileContent = fs.readFileSync(req.file.path);

    // Generate S3 parameters for replacing the original file
    const s3Params = {
      Bucket: bucketName,
      Key: key, // Keep the same key to overwrite the original submission
      Body: fileContent,
      ContentType: "application/pdf",
    };

    // Upload the updated PDF back to S3 (overwriting the original file)
    await s3.send(new PutObjectCommand(s3Params));

    // Update submission metadata
    submission.score = score || submission.score; // Update the score if provided
    submission.notes = notes || submission.notes; // Update notes if provided
    submission.isMarked = true; // Mark the submission as marked
    await submission.save();

    // Cleanup: Remove the uploaded file from local storage
    fs.unlinkSync(req.file.path);

    // Respond with success
    res.status(200).json({
      message: "Submission marked and replaced successfully",
      updatedSubmission: submission,
    });
  } catch (error) {
    console.error("Error marking and replacing the submission:", error);

    // Cleanup: Remove the uploaded file from local storage in case of error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return next(new Error("Failed to mark and replace the submission", { cause: 500 }));
  }
});

export const deleteAssignmentWithSubmissions = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Input Validation & Authorization ---
    const { assignmentId } = req.body;
    const teacherId = req.user._id;

    if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
        return next(new Error("A valid Assignment ID is required.", { cause: 400 }));
    }

    // --- Phase 2: Prepare - Parallel Data Fetching ---
    // Fetch all necessary documents in parallel for maximum performance.
    const [assignment, submissions] = await Promise.all([
        assignmentModel.findById(assignmentId).select('key createdBy').lean(),
        SubassignmentModel.find({ assignmentId }).select('key').lean()
    ]);
    
    if (!assignment) {
        return next(new Error("Assignment not found.", { cause: 404 }));
    }

    // SECURITY UPGRADE: Ensure only the creator can delete the assignment.
    // You could add a role check here for super-admins, e.g., `|| req.user.role === 'superadmin'`
    if (!assignment.createdBy.equals(teacherId)) {
        return next(new Error("You are not authorized to delete this assignment.", { cause: 403 }));
    }

    // --- Phase 3: Execute - Atomic Database Transaction ---
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const submissionIds = submissions.map(s => s._id);

        // Delete all submission documents for this assignment
        if (submissionIds.length > 0) {
            await SubassignmentModel.deleteMany({ _id: { $in: submissionIds } }, { session });
        }

        // Remove dangling references from all affected students
        if (submissionIds.length > 0) {
            await studentModel.updateMany(
                { submittedassignments: { $in: submissionIds } },
                { $pull: { submittedassignments: { $in: submissionIds } } },
                { session }
            );
        }
        
        // Finally, delete the assignment itself
        await assignmentModel.findByIdAndDelete(assignmentId, { session });
        
        // If all database operations succeed, commit the transaction.
        await session.commitTransaction();

    } catch (error) {
        // If any DB operation fails, abort the entire transaction.
        await session.abortTransaction();
        console.error("Database transaction failed during assignment deletion:", error);
        return next(new Error("Failed to delete assignment due to a database error. Operation rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
    }

    // --- Phase 4: Post-Commit Cleanup - S3 Deletion ---
    // This phase only runs if the database transaction was successful.
    const objectsToDelete = submissions.map(sub => ({ Key: sub.key })).filter(item => item.Key);
    if (assignment.key) {
        objectsToDelete.push({ Key: assignment.key });
    }

    if (objectsToDelete.length > 0) {
        try {
            await s3.send(new DeleteObjectsCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Delete: { Objects: objectsToDelete },
            }));
        } catch (s3Error) {
            // Log the S3 error but don't fail the request, as the DB part is already done.
            // This would be a good place to send an alert to an admin.
            console.error("CRITICAL: Database records were deleted, but S3 cleanup failed.", s3Error);
        }
    }

    res.status(200).json({
        message: "Assignment and all related data deleted successfully.",
    });
});
// --- Fully Refactored User/Teacher Delete Function ---
export const deleteSubmittedAssignment = asyncHandler(async (req, res, next) => {
    // --- Phase 1: Fail Fast - Input Validation ---
    const { submissionId } = req.body;
    const { user, isteacher } = req;

    if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("A valid Submission ID is required.", { cause: 400 }));
    }

    // --- Phase 2: Prepare - Parallel Data Fetching ---
    // Fetch all documents needed for authorization. Use .lean() for fast, read-only results.
    const submission = await SubassignmentModel.findById(submissionId).lean();
    
    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // Fetch the parent assignment only if we need it for teacher authorization.
    let assignment;
    if (isteacher?.teacher === true) {
        assignment = await assignmentModel.findById(submission.assignmentId).select('createdBy').lean();
    }

    // --- Phase 3: Robust Authorization ---
    let isAuthorized = false;
    // Condition 1: The user is the student who made the submission.
    if (user._id.equals(submission.studentId)) {
        isAuthorized = true;
    }
    // Condition 2 (Secure): The user is a teacher AND created the original assignment.
    // To allow any teacher, you would remove the second part of this condition.
    else if (isteacher?.teacher === true && assignment?.createdBy.equals(user._id)) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
    
    // --- Phase 4: Execute - Atomic Database Transaction ---
    // The transaction is now simpler and only contains ONE operation.
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        await SubassignmentModel.findByIdAndDelete(submission._id, { session });
        await session.commitTransaction();
    } catch (error) {
        await session.abortTransaction();
        console.error("Database transaction failed during submission deletion:", error);
        return next(new Error("Failed to delete submission due to a database error. Operation rolled back.", { cause: 500 }));
    } finally {
        await session.endSession();
    }

    // --- Phase 5: Post-Commit Cleanup - S3 Deletion ---
    // This only runs if the database transaction was successful.
    if (submission.key) {
        try {
            await s3.send(new DeleteObjectCommand({
                Bucket: submission.bucketName,
                Key: submission.key,
            }));
        } catch (s3Error) {
            // Log this as a critical failure for an admin to investigate, but don't fail the request.
            // The database record is gone, which is the most important part.
            console.error(`CRITICAL: DB record for submission ${submission._id} was deleted, but S3 cleanup failed for key ${submission.key}.`, s3Error);
        }
    }

    res.status(200).json({ message: "Submission deleted successfully." });
});