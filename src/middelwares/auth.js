import mongoose from 'mongoose'
import  { teacherModel }  from '../../DB/models/teacher.model.js'
import { asyncHandler } from '../utils/erroHandling.js'
import { generateToken, verifyToken } from '../utils/tokenFunctions.js'
import studentModel from '../../DB/models/student.model.js'
import { sectionModel } from '../../DB/models/section.model.js'; // Make sure this path is correct

function parseAuthHeader(req) {
  // Express lowercases header names
  const raw = (req.headers.authorization || "").toString().trim();
  if (!raw) return { error: "Please login first" };

  // strip surrounding quotes and collapse whitespace
  const cleaned = raw.replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ");

  const parts = cleaned.split(" ");
  let scheme = "", token = "";
  if (parts.length >= 2) {
    scheme = parts[0];
    token  = parts.slice(1).join(" ");
  } else {
    token = parts[0]; // allow bare token
  }

  // Accept MonaEdu or Bearer (case-insensitive); ignore any other scheme
  if (scheme && !/^(MonaEdu)$/i.test(scheme)) {
    return { error: "Unsupported auth scheme" };
  }
  if (!token) return { error: "Token is required." };
  if (/[\r\n]/.test(token)) return { error: "Invalid characters in token" };

  return { token, scheme: scheme || "bare" };
}


export const canEditSection = asyncHandler(async (req, res, next) => {
    // 1. This action is for teachers only.
    if (!req.isteacher) {
        return next(new Error('Forbidden: This action is only available to teachers.', { cause: 403 }));
    }
    

    // 2. A main_teacher has universal edit access.
    if (req.user.role === 'main_teacher') {
        return next();
    }

    // 3. Logic for assistants.
    if (req.user.role === 'assistant') {

        const sectionId = req.params.sectionId || req.body.sectionId || req.query.sectionId;
        if (!sectionId) {
            return next(new Error('Bad Request: Section ID is required.', { cause: 400 }));
        }
if (!mongoose.isValidObjectId(sectionId)) {
  return next(new Error('Bad Request: Invalid section ID format.', { cause: 400 }));
}

        const section = await sectionModel.findById(sectionId).select('groupIds').lean();
        if (!section) {
            return next(new Error('Not Found: The specified section does not exist.', { cause: 404 }));
        }
        const permittedGroupIds = req.user.permissions.sections?.map(id => id.toString()) || [];

        // Get the groups the assistant is allowed to manage.
        if (permittedGroupIds.length === 0) {
            return next(new Error('Forbidden: You are not assigned to manage any groups.', { cause: 403 }));
        }

        // Get the groups this section belongs to.
        const sectionGroupIds = section.groupIds.map(id => id.toString());

        // Check if there is any overlap between the assistant's permitted groups and the section's groups.
        const hasPermission = sectionGroupIds.some(groupId => permittedGroupIds.includes(groupId));

        if (hasPermission) {
            return next(); // The assistant has permission for at least one of the section's groups.
        } else {
            return next(new Error('Forbidden: You do not have permission to edit this section as you do not manage its associated groups.', { cause: 403 }));
        }
    }

    // Fallback deny.
    return next(new Error('Forbidden: You are not authorized for this action.', { cause: 403 }));
});

export const canManageGroupStudents = asyncHandler(async (req, res, next) => {
    // 1. Check if the user is a teacher. isAuth must run first.
    if (!req.isteacher) {
        return next(new Error('Forbidden: This action is only available to teachers.', { cause: 403 }));
    }

    const { role, permissions } = req.user;
    const { groupid } = req.body;
if (!groupid) {
  return next(new Error('Group ID is required in the request body.', { cause: 400 }));
}
if (!mongoose.isValidObjectId(groupid)) {
  return next(new Error('Bad Request: Invalid group ID format.', { cause: 400 }));
}
    // 2. If the user is a main_teacher, they have unrestricted access.
    if (role === 'main_teacher') {
        return next();
    }

    // 3. If the user is an assistant, check their permissions.
    if (role === 'assistant') {
        if (!groupid) {
            return next(new Error('Group ID is required in the request body.', { cause: 400 }));
        }

        // Get the assistant's permitted groups.
        const permittedGroupIds = permissions.groups?.map(id => id.toString()) || [];
        
        // Check if the requested groupid is in their list of permitted groups.
        if (permittedGroupIds.includes(groupid)) {
            return next();
        } else {
            return next(new Error('Forbidden: You do not have permission to manage this group.', { cause: 403 }));
        }
    }

    // 4. Fallback for any other case (should not be reached).
    return next(new Error('Forbidden: You are not authorized to perform this action.', { cause: 403 }));
});

export const isAuth = asyncHandler(async (req, res, next) => {
  const { token, error } = parseAuthHeader(req);
  if (error) return next(new Error(error, { cause: 401 }));

  const secret = process.env.SIGN_IN_TOKEN_SECRET;
  if (!secret) return next(new Error("Server misconfig: missing SIGN_IN_TOKEN_SECRET", { cause: 500 }));

  try {
    const decoded = verifyToken({ token, signature: secret });
    if (!decoded?._id) return next(new Error('Invalid token payload.', { cause: 401 }));
    if (!mongoose.Types.ObjectId.isValid(decoded._id)) {
      return next(new Error('Invalid user ID in token', { cause: 400 }));
    }

    let user;  

    if (decoded.role !== 'student') {
      user = await teacherModel
        .findById(decoded._id, 'email name role permissions')
        .lean();

      req.isteacher = true;
    }else{ 
       user = await studentModel
      .findById(decoded._id, 'email userName groupIds') 
      .lean();
      req.isteacher = false;
  }
      if (!user) return next(new Error('User not found. Please sign up.', { cause: 404 }));


    req.user = user;
    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return next(new Error('Your session has expired. Please log in again.', { cause: 401 }));
    return next(new Error('Invalid token. Please log in again.', { cause: 401 }));
  }
});

export const AdminAuth = asyncHandler(async (req, res, next) => {
  try {
    const { token, error } = parseAuthHeader(req);
    if (error) return next(new Error(error, { cause: 401 }));

    const secret = process.env.SIGN_IN_TOKEN_SECRET;
    if (!secret) return next(new Error("Server misconfig: missing SIGN_IN_TOKEN_SECRET", { cause: 500 }));

    const decoded = verifyToken({ token, signature: secret });
    if (!decoded?._id) return next(new Error('Invalid token payload.', { cause: 401 }));
    if (!mongoose.isValidObjectId(decoded._id)) {
      return next(new Error("Invalid user ID in token", { cause: 400 }));
    }

    const teacher = await teacherModel
      .findById(decoded._id)
      .select('email role permissions name')
      .lean();

    if (!teacher) return next(new Error('User not found. Please sign up or log in again.', { cause: 404 }));
    if (teacher.role !== 'main_teacher') {
      return next(new Error('Forbidden: You do not have sufficient permissions to perform this action.', { cause: 403 }));
    }

    req.isteacher = true;
    req.user = teacher;
    return next();

  } catch (error) {
    if (error.name === 'TokenExpiredError')
      return next(new Error('Token has expired. Please log in again.', { cause: 401 }));
    if (error.name === 'JsonWebTokenError')
      return next(new Error('Invalid token or signature.', { cause: 401 }));
    console.error("Unexpected error in AdminAuth:", error);
    return next(new Error('Authentication failed due to a server error.', { cause: 500 }));
  }
});

