import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand,getPresignedUrlForS3 ,PutObjectCommand} from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import { pagination } from "../../../utils/pagination.js";
import studentModel from "../../../../DB/models/student.model.js";

export const getStudentsSubmission = asyncHandler(async (req, res, next) => {
  const { assignmentId, groupId, status, page = 1, size = 10 } = req.query;

  // 1️⃣ Validate assignmentId
  if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId)) {
    return next(new Error("Valid assignmentId is required", { cause: 400 }));
  }
  const aId = new mongoose.Types.ObjectId(assignmentId);

  // 2️⃣ Load assignment
  const assignment = await assignmentModel.findById(aId).lean();
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 3️⃣ Derive the student list from assignment.enrolledStudents :contentReference[oaicite:0]{index=0}
  //    and optionally filter by groupId
  let studentFilter = { _id: { $in: assignment.enrolledStudents } };
  if (groupId) {
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return next(new Error("Valid groupId is required", { cause: 400 }));
    }
    const gId = new mongoose.Types.ObjectId(groupId);

    // ensure this group is actually linked to the assignment
    if (
      !assignment.groupIds ||
      !assignment.groupIds.some(g => g.equals(gId))
    ) {
      return next(
        new Error("Invalid group ID with assignmentId", { cause: 400 })
      );
    }

    // only include students whose current groupId matches  
    studentFilter.groupId = gId;
  }

  // 4️⃣ Fetch student docs  
  const studentsList = await studentModel
    .find(studentFilter)
    .select("_id userName firstName lastName")   // only needed fields :contentReference[oaicite:1]{index=1}
    .lean();

  // 5️⃣ No students attached?
  if (studentsList.length === 0) {
    return res.status(200).json({ Message: "No Student Attached to it" });
  }

  // 6️⃣ Fetch all submissions for these students & this assignment
  const subs = await SubassignmentModel.find({
    assignmentId: aId,
    studentId: { $in: studentsList.map(s => s._id) }
  })
    .select("studentId createdAt")
    .lean();  // createdAt gives us submission timestamp :contentReference[oaicite:2]{index=2}

  // 7️⃣ Build a map: studentId → latestCreatedAt
  const subMap = {};
  for (const sub of subs) {
    const sid = sub.studentId.toString();
    const ts = sub.createdAt;
    if (!subMap[sid] || ts > subMap[sid]) {
      subMap[sid] = ts;
    }
  }

  // 8️⃣ Merge into a single flat array with status + formatted submittedAt
  const allStudents = studentsList.map(s => {
    const sid = s._id.toString();
    const has = Boolean(subMap[sid]);
    return {
      _id: s._id,
      userName: s.userName,
      firstName: s.firstName,
      lastName: s.lastName,
      status: has ? "submitted" : "not submitted",
      submittedAt: has
        ? new Date(subMap[sid]).toLocaleString()
        : null
    };
  });

  // 9️⃣ Apply status filter if requested
  let filtered = allStudents;
  if (status === "submitted") {
    filtered = allStudents.filter(s => s.status === "submitted");
  } else if (status === "not_submitted") {
    filtered = allStudents.filter(s => s.status === "not submitted");
  }

  // 🔟 Paginate
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const sz = Math.max(1, parseInt(size, 10) || 10);
  const { limit, skip } = pagination({ page: pg, size: sz });

  const total = filtered.length;
  const paged = filtered.slice(skip, skip + limit);

  // 🏁 Final response
  res.status(200).json({
    Message: "Submissions fetched successfully",
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: pg,
    students: paged
  });
});


export const GetAllByGroup = asyncHandler (async  (req, res, next) => {
  const {groupId}= req.body ;
  req.user.groupId = await studentModel.findById(user._Id);
  if(req.isteacher.teacher== false&& req.user.groupId ==groupId){
    return next(new Error("The Studednt no in This group", { cause: 401 }));
    ;
  }
  const ass = await assignmentModel.find({groupId:groupId});
  res.status(201).json(ass)
})



export const getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
  const { groupId, assignmentId, status, page = 1, size = 10 } = req.query; // Extract parameters with defaults

  // Validate groupId
  if (!groupId) {
    return next(new Error("Group ID is required", { cause: 400 }));
  }

  try {
    // Build query filters
    const query = { groupId };

    // Filter by assignmentId if provided
    if (assignmentId) {
      // Ensure the assignment belongs to the group
      const assignment = await assignmentModel.findOne({ _id: assignmentId, groupId });
      if (!assignment) {
        return next(new Error("Invalid assignment ID for the provided group", { cause: 400 }));
      }
      query.assignmentId = assignmentId;
    }

    // Filter by status if provided
    if (status === "marked") {
      query.isMarked = true;
    } else if (status === "unmarked") {
      query.isMarked = false;
    }

    // Get pagination details
    const { limit, skip } = pagination({ page, size });

    // Fetch submissions with filtering, pagination, and sorting
    const submissions = await SubassignmentModel.find(query)
      .sort({ isMarked: 1, createdAt: -1 }) // Unmarked first, then by newest submissions
      .limit(limit)
      .skip(skip)
      .populate("studentId", "userName firstName lastName") // Populate student info
      .populate("assignmentId", "name"); // Populate assignment info

    // Count total submissions for pagination metadata
    const totalSubmissions = await SubassignmentModel.countDocuments(query);

    // Respond with the submissions and metadata
    res.status(200).json({
      message: "Submissions fetched successfully",
      totalSubmissions,
      totalPages: Math.ceil(totalSubmissions / limit),
      currentPage: parseInt(page, 10),
      submissions,
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return next(new Error("Failed to fetch submissions", { cause: 500 }));
  }
});

export const getSubmissions = asyncHandler(async (req, res, next) => {
  const { assignmentId, submissionId } = req.query;
  const userId = req.user._id;
  const isTeacher = req.isteacher?.teacher === true;

  // 1) assignmentId required
  if (!assignmentId) {
    return next(new Error("Assignment ID is required", { cause: 400 }));
  }

  // 2) load assignment
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // 3) if student, verify they’re in the assignment’s group
  if (!isTeacher) {
    const student = await studentModel.findById(userId);
    if (!student) {
      return next(new Error("Student record not found", { cause: 404 }));
    }
    if (!assignment.groupId.equals(student.groupId)) {
      return next(new Error("You’re not authorized to view these submissions", { cause: 403 }));
    }
  }

  let submissions;
  if (submissionId) {
    // 4a) single submission
    submissions = await SubassignmentModel.findOne({
      _id: submissionId,
      assignmentId,
    }).populate("studentId", "userName firstName lastName email");
    if (!submissions) {
      return next(new Error("Submission not found", { cause: 404 }));
    }
    if (
      !isTeacher &&
      submissions.studentId._id.toString() !== userId.toString()
    ) {
      return next(new Error("You’re not authorized to view this submission", { cause: 403 }));
    }
  } else {
    // 4b) all submissions (with pagination)
    const { limit, skip } = pagination(req.query);
    const query = { assignmentId };
    if (!isTeacher) query.studentId = userId;

    submissions = await SubassignmentModel.find(query)
      .populate("studentId", "userName firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ isMarked: 1, createdAt: -1 });
  }

  res.status(200).json({
    message: "Submissions retrieved successfully",
    submissions,
  });
});

export const getAssignmentsForStudent = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 10, status } = req.query;

  const user = req.user; // The authenticated user
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();

  try {
    const query = {};

    if (isTeacher) {
      // If the user is a teacher, fetch assignments they created or all assignments
      if (req.query.groupId && mongoose.Types.ObjectId.isValid(req.query.groupId)) {
        query.groupId = req.query.groupId; // Filter by group if specified
      }
    } else {
      // For students, filter by their group
      
        let student = await studentModel.findById(user._id).lean();
          if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }
      query.groupId = student.groupId;
    }


    if (status) {
      if (status === "active") {
        query.startDate = { $lte: currentDate };
        query.endDate = { $gte: currentDate };
      } else if (status === "upcoming") {
        query.startDate = { $gt: currentDate };
      } else if (status === "expired") {
        query.endDate = { $lt: currentDate };
      }
    }

    // Pagination helpers
    const { limit, skip } = pagination({ page, size });

    // Fetch assignments
    const assignments = await assignmentModel
      .find(query)
      .sort({ startDate: 1 }) // Sort by start date
      .skip(skip)
      .limit(limit)
      .select("name startDate endDate groupId rejectedStudents enrolledStudents") // Select specific fields
      .populate("groupId", "name"); // Populate group details

    // Total count for pagination
    const totalAssignments = await assignmentModel.countDocuments(query);

    // Response
    res.status(200).json({
      message: "Assignments fetched successfully",
      totalAssignments,
      totalPages: Math.ceil(totalAssignments / limit),
      currentPage: parseInt(page, 10),
      assignments,
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    next(new Error("Failed to fetch assignments", { cause: 500 }));
  }
});


export const ViewSub = asyncHandler(async(req, res, next) =>{


  const userId    = req.user._id;
  const isTeacher = req.isteacher.teacher;
  const { SubassignmentId } = req.query;

  // fetch it
  const assignment = await SubassignmentModel.findById(SubassignmentId);
  if (!assignment) {
    return next(new Error("Subassignment not found", { cause: 404 }));
  }

  if (!isTeacher) {
    
    if ( assignment.studentId != userId ) {
      return next(new Error("You are not valid to it boy ", { cause: 403 }));
    }
  }

  // anyone authorized gets a presigned GET URL
  const presignedUrl = await getPresignedUrlForS3(
    assignment.bucketName,
    assignment.key,
    60 * 30
  );
  res.status(200).json({
    message:     "Material is ready for viewing",
    presignedUrl,
  });
});



