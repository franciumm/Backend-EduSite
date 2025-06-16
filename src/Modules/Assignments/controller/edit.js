import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand,DeleteObjectCommand} from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import { groupModel } from "../../../../DB/models/groups.model.js";
import studentModel from "../../../../DB/models/student.model.js";


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
  const student = await studentModel.findById(req.user._id);
  if (!student) {
    return next(new Error("Student record not found", { cause: 404 }));
  }

  // 3. Check authorization
  const isTeacher = req.isteacher.teacher === true;
  if (!isTeacher) {
    // FIX: Check if the student is assigned to a group BEFORE comparing IDs
    if (!student.groupId) {
      return next(new Error("You are not assigned to any group.", { cause: 403 }));
    }

    // Now it's safe to compare
    const studentGroupIdStr = groupId.toString();
// Convert the array of ObjectId to an array of strings for comparison
const assignmentGroupIdsStr = assignment.groupIds.map(id => id.toString());

// FIX: Check if the student's group is in the assignment's list of allowed groups
if (!isTeacher && !assignmentGroupIdsStr.includes(studentGroupIdStr)) {
    return next(new Error("You’re not in the right group for this assignment", { cause: 403 }));
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
});

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

  // Ensure assignmentId is provided
  if (!assignmentId) {
    return next(new Error("Assignment ID is required", { cause: 400 }));
  }

  try {
    // Fetch the assignment to validate its existence
    const assignment = await assignmentModel.findById(assignmentId);
    if (!assignment) {
      return next(new Error("Assignment not found", { cause: 404 }));
    }

    // Get all related submissions for the assignment
    const submissions = await SubassignmentModel.find({ assignmentId });

    // Delete all related submissions
    for (const submission of submissions) {
      try {
        // Delete the submission's file from S3
        if (submission.bucketName && submission.key) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: submission.bucketName,
              Key: submission.key,
            })
          );
        }

        // Delete the submission from the database
        await SubassignmentModel.findByIdAndDelete(submission._id);
      } catch (error) {
        console.error(`Failed to delete submission with ID ${submission._id}:`, error);
      }
    }

    // Delete the assignment's file from S3
    try {
      if (assignment.bucketName && assignment.key) {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: assignment.bucketName,
            Key: assignment.key,
          })
        );
      }
    } catch (error) {
      console.error(`Failed to delete assignment file from S3:`, error);
    }

    // Delete the assignment from the database
    await assignmentModel.findByIdAndDelete(assignmentId);

    // Return success response
    res.status(200).json({
      message: "Assignment and all related submissions deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting assignment and submissions:", error);
    return next(new Error("Failed to delete assignment and submissions", { cause: 500 }));
  }
});


export const deleteSubmittedAssignment = asyncHandler(async (req, res, next) => {
  const { submissionId } = req.body;

  if (!submissionId) {
    return next(new Error("Submission ID is required", { cause: 400 }));
  }

  // Fetch the submission
  const submission = await SubassignmentModel.findById(submissionId);
  if (!submission) {
    return next(new Error("Submission not found", { cause: 404 }));
  }

  // Authorization: Allow only the teacher or the student who submitted it to delete
  if (
    req.isteacher.teacher === false &&
    submission.studentId.toString() !== req.user._id.toString()
  ) {
    return next(new Error("You are not authorized to delete this submission", { cause: 403 }));
  }

  try {
    // Delete file from S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: submission.bucketName,
        Key: submission.key,
      })
    );

    // Delete submission from the database
    await SubassignmentModel.findByIdAndDelete(submissionId);

    res.status(200).json({ message: "Submission deleted successfully" });
  } catch (error) {
    console.error("Error deleting submission:", error);
    next(new Error("Failed to delete the submission", { cause: 500 }));
  }
});
