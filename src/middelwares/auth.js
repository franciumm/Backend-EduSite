import mongoose from 'mongoose'
import  { teacherModel }  from '../../DB/models/teacher.model.js'
import { asyncHandler } from '../utils/erroHandling.js'
import { generateToken, verifyToken } from '../utils/tokenFunctions.js'
import studentModel from '../../DB/models/student.model.js'
import { sectionModel } from '../../DB/models/section.model.js'; // Make sure this path is correct




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
    const { Authorization } = req.headers
    if (!Authorization || !Authorization.startsWith('MonaEdu')) {
        return next(new Error('Please login first', { cause: 401 }))
    }

    const splitedToken = Authorization.split(' ')[1]
    if (!splitedToken) {
        return next(new Error('Token is missing', { cause: 401 }));
    }

    try {
        const decodedData = verifyToken({
            token: splitedToken,
            signature: process.env.SIGN_IN_TOKEN_SECRET,
        });

        if (!mongoose.Types.ObjectId.isValid(decodedData._id)) {
            return next(new Error('Invalid user ID in token', { cause: 400 }))
        }

        // Try to find a student first
        let findUser = await studentModel.findById(decodedData._id, 'email userName gradeId groupId').lean();
        req.isteacher = false;

        if (!findUser) {
            // If not a student, try to find a teacher/assistant
            findUser = await teacherModel.findById(decodedData._id, 'email name role permissions').lean();
                
            if(!findUser){
                return next(new Error('User not found. Please sign up.', { cause: 404 }))
            }
            req.isteacher = true;
        }

        req.user = findUser;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return next(new Error('Your session has expired. Please log in again.', { cause: 401 }));
        }
        // For other JWT errors (e.g., invalid signature)
        return next(new Error('Invalid token. Please log in again.', { cause: 401 }));
    }
});




export const AdminAuth = asyncHandler(async (req, res, next) => {
    try {
        const { Authorization } = req.headers;

        if (!Authorization || !Authorization.startsWith('MonaEdu')) {
            return next(new Error('Invalid authorization header.', { cause: 401 }));
        }

        const token = Authorization.split(' ')[1];
        if (!token) {
            return next(new Error('Token is required.', { cause: 401 }));
        }

        // 1. Verify the token's signature and expiration
        const decoded = verifyToken({
            token,
            signature: process.env.SIGN_IN_TOKEN_SECRET,
        });

        if (!decoded?._id) {
            return next(new Error('Invalid token payload.', { cause: 401 }));
        }

        // 2. Check if the user still exists in the database
        const teacher = await teacherModel.findById(decoded._id).select('email role');
        if (!teacher) {
            return next(new Error('User not found. Please sign up or log in again.', { cause: 404 }));
        }
        if (teacher.role !== 'main_teacher') {
          return next(new Error('Forbidden: You do not have sufficient permissions to perform this action.', { cause: 403 }));
        }

        // 3. (Optional but Recommended) Check if the user has the 'Admin' role
        // if (teacher.role !== 'Admin') {
        //   return next(new Error('You are not authorized to perform this action.', { cause: 403 })); // 403 Forbidden
        // }

        // 4. Attach user to the request and proceed
        req.user = teacher;
        next();
        
    } catch (error) {
        // This catch block now handles errors gracefully and provides clear messages.
        
        // If JWT throws a "token expired" error
        if (error.name === 'TokenExpiredError') {
            return next(new Error('Token has expired. Please log in again.', { cause: 401 }));
        }

        // If JWT throws any other verification error (e.g., invalid signature)
        if (error.name === 'JsonWebTokenError') {
            return next(new Error('Invalid token or signature.', { cause: 401 }));
        }
        
        // For any other unexpected errors (like a DB failure), pass it to the global handler
        console.error("Unexpected error in AdminAuth:", error);
        return next(new Error('Authentication failed due to a server error.', { cause: 500 }));
    }
});
