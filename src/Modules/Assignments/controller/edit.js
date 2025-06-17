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
    const { assignmentId } = req.body;
    if (!assignmentId) {
        return next(new Error("Assignment ID is required", { cause: 400 }));
    }

    const assignment = await assignmentModel.findById(assignmentId);
    if (!assignment) {
        return next(new Error("Assignment not found", { cause: 404 }));
    }

    const submissions = await SubassignmentModel.find({ assignmentId }).select('key studentId');

    // --- S3 Cleanup ---
    const objectsToDelete = [];
    // Add the main assignment file to the list
    if (assignment.key) {
        objectsToDelete.push({ Key: assignment.key });
    }
    // Add all submission files to the list
    submissions.forEach(sub => {
        if (sub.key) {
            objectsToDelete.push({ Key: sub.key });
        }
    });

    // FIX 1: Batch delete S3 objects for efficiency and atomicity.
    if (objectsToDelete.length > 0) {
        await s3.send(new DeleteObjectsCommand({
            Bucket: process.env.S3_BUCKET_NAME, // Assuming one bucket for all
            Delete: { Objects: objectsToDelete },
        }));
    }

    // --- Database Cleanup ---
    // FIX 2: Use bulk operations for efficiency.
    // Delete all submission documents for this assignment
    await SubassignmentModel.deleteMany({ assignmentId });

    // FIX 3 (CRITICAL): Remove dangling references from all affected students.
    // This maintains data integrity.
    const submissionIds = submissions.map(s => s._id);
    if (submissionIds.length > 0) {
        await studentModel.updateMany(
            { submittedassignments: { $in: submissionIds } },
            { $pull: { submittedassignments: { $in: submissionIds } } }
        );
    }
    
    // Finally, delete the assignment itself
    await assignmentModel.findByIdAndDelete(assignmentId);

    res.status(200).json({
        message: "Assignment and all related submissions deleted successfully.",
    });
});


// --- Fully Refactored User/Teacher Delete Function ---

export const deleteSubmittedAssignment = asyncHandler(async (req, res, next) => {
    // --- 1. Input Validation ---
    const { submissionId } = req.body;
    if (!submissionId) {
        return next(new Error("Submission ID is required.", { cause: 400 }));
    }
    // FIX: Validate that the ID is a valid MongoDB ObjectId format before querying the DB.
    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
        return next(new Error("Invalid Submission ID format.", { cause: 400 }));
    }

    // --- 2. Fetch Data ---
    // Fetch the submission and the necessary related data for authorization.
    const submission = await SubassignmentModel.findById(submissionId)
        .populate({ path: 'assignmentId', select: 'createdBy' }); // Populate creator of the assignment

    if (!submission) {
        return next(new Error("Submission not found.", { cause: 404 }));
    }

    // --- 3. Authorization Logic (Clear and Explicit) ---
    let isAuthorized = false;
    const { user, isteacher } = req; // Destructure for cleaner access

    // Condition 1: The user is the student who made the submission.
    if (user._id.equals(submission.studentId)) {
        isAuthorized = true;
    }
    // Condition 2: The user is a teacher AND is the one who created the original assignment.
    else if (isteacher?.teacher === true && submission.assignmentId?.createdBy.equals(user._id)) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return next(new Error("You are not authorized to delete this submission.", { cause: 403 }));
    }
    
    // --- 4. Deletion Logic with Guaranteed Integrity (Using a Transaction) ---
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // First, delete the file from S3. If this fails, we don't touch the database.
        if (submission.key) {
            await s3.send(new DeleteObjectCommand({
                Bucket: submission.bucketName,
                Key: submission.key,
            }));
        }

        // DB Operation 1: Remove the reference from the student's document.
        // This is the CRITICAL data integrity fix you requested.
        const updateStudent = await studentModel.findByIdAndUpdate(
            submission.studentId,
            { $pull: { submittedassignments: submission._id } },
            { new: true, session } // Pass the session to include this in the transaction
        );
        
        if (!updateStudent) {
            // This is an edge case where the student was deleted after submission.
            // We should abort to prevent leaving an orphaned submission document.
            throw new Error(`Student with ID ${submission.studentId} not found. Cannot remove submission reference.`);
        }

        // DB Operation 2: Delete the submission document itself.
        await SubassignmentModel.findByIdAndDelete(submission._id, { session });

        // If both database operations succeed, commit the transaction.
        await session.commitTransaction();

        res.status(200).json({ message: "Submission deleted successfully." });

    } catch (error) {
        // If any error occurs (S3 or DB), abort the entire transaction.
        await session.abortTransaction();
        console.error("Transaction aborted:", error);
        // Pass the error to the global error handler.
        return next(new Error("Failed to delete the submission due to a server error.", { cause: 500 }));
    } finally {
        // Always end the session to clean up resources.
        session.endSession();
    }
});