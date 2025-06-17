import mongoose from 'mongoose'
import UserModel  from '../../DB/models/student.model.js'
import  { teacherModel }  from '../../DB/models/teacher.model.js'
import { asyncHandler } from '../utils/erroHandling.js'
import { generateToken, verifyToken } from '../utils/tokenFunctions.js'
import studentModel from '../../DB/models/student.model.js'


export const isAuth = asyncHandler(async (req, res, next) => {
    try {
    
    const { authorization } = req.headers
    if (!authorization ) {
        return next(new Error('Please login first', { cause: 400 }))
    }

    if (!authorization.startsWith('MonaEdu')) {
        return next(new Error('invalid token prefix', { cause: 400 }))
    }

    const splitedToken = authorization.split(' ')[1]
    

    try {
        const decodedData = verifyToken({
        token: splitedToken,
        signature: process.env.SIGN_IN_TOKEN_SECRET,
        })

            
    if (!mongoose.Types.ObjectId.isValid(decodedData._id)) {
        return next(new Error('invalid UserId', { cause: 400 }))
    }
    
  
        var findUser = await studentModel.findById(
        decodedData._id,
        'email userName gradeId groupId',
        );
        req.isteacher = {teacher : false} ;
        if (!findUser) {
           
           
            findUser = await teacherModel.findById(
                decodedData._id,
                'email',
                );
  
    
         
                
        if(!findUser){
            return next(new Error('Please SignUp', { cause: 400 }))
        }
        req.isteacher = {teacher : true} ;
        }

        req.user = findUser;
        next()
    } catch (error) {
        // token  => search in db
        if (error == 'TokenExpiredError: jwt expired') {
          // refresh token
        const user = await UserModel.findOne({ token: splitedToken })
        if (!user) {
            return next(new Error('Wrong token', { cause: 400 }))
        }
          // generate new token
        const userToken = generateToken({
            payload: {
            email: user.email,
            _id: user._id,
            
            },
            signature: process.env.SIGN_IN_TOKEN_SECRET,
            expiresIn: '2h',
        })

        if (!userToken) {
            return next(
            new Error('token generation fail, payload canot be empty', {
                cause: 400,
            }),
            )
        }

        user.token = userToken
        await user.save()
        return res.status(200).json({ message: 'Token refreshed', userToken })
        }
        return next(new Error('invalid token', { cause: 500 }))
    }
    } catch (error) {
    console.log(error)
    next(new Error('catch error in auth', { cause: 500 }))
    }
})




export const AdminAuth = asyncHandler(async (req, res, next) => {
    try {
        const { authorization } = req.headers;

        if (!authorization || !authorization.startsWith(process.env.BEARER_TOKEN)) {
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
        const teacher = await teacherModel.findById(decoded._id).select('email userName role');
        if (!teacher) {
            return next(new Error('User not found. Please sign up or log in again.', { cause: 404 }));
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
