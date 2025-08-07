import mongoose from 'mongoose'
import UserModel  from '../../DB/models/student.model.js'
import  { teacherModel }  from '../../DB/models/teacher.model.js'
import { asyncHandler } from '../utils/erroHandling.js'
import { generateToken, verifyToken } from '../utils/tokenFunctions.js'
import studentModel from '../../DB/models/student.model.js'



export const isAuth = asyncHandler(async (req, res, next) => {
    const { authorization } = req.headers
    if (!authorization || !authorization.startsWith('MonaEdu')) {
        return next(new Error('Please login first', { cause: 401 }))
    }

    const splitedToken = authorization.split(' ')[1]
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
        const { authorization } = req.headers;

        if (!authorization || !authorization.startsWith('MonaEdu')) {
            return next(new Error('Invalid authorization header.', { cause: 401 }));
        }

        const token = authorization.split(' ')[1];
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
