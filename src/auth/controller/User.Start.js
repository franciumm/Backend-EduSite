import  UserModel  from "../../../DB/models/student.model.js";
import { asyncHandler } from "../../utils/erroHandling.js";
import jwt from 'jsonwebtoken'
import bycrypt from 'bcrypt'
import SendMail from "../../utils/Mailer.js";
import { generateToken } from "../../utils/tokenFunctions.js";
import { teacherModel } from "../../../DB/models/teacher.model.js";
import { gradeModel } from "../../../DB/models/grades.model.js";
import  studentModel  from "../../../DB/models/student.model.js";
import { groupModel } from "../../../DB/models/groups.model.js"; 
import { SubassignmentModel } from "../../../DB/models/submitted_assignment.model.js";

import { SubexamModel } from "../../../DB/models/submitted_exams.model.js";

export const Signup = asyncHandler(async(req,res,next)=>{
    const {email,parentemail,userName,firstName,lastName,password,grade ,  parentphone ,phone,cPassword}= req.body ;
    
    if(await UserModel.findOne({$or:[{email},{userName},{phone}]})){
        return next( Error( 'User Email or Username or phone Exists', {cause:409}));
    } 
    const  gradeOBJ = await gradeModel.findOne({grade});
    if(!(gradeOBJ)){
        return next( Error('Invalid Grade Id ', {cause:409}));
    }
    if(password != cPassword){
        return next( Error('Password Doesn`t match'), {cause:403});
    }
    
  
    
    const token = jwt.sign({  email, user:{firstName,lastName,email,parentemail,gradeId: gradeOBJ._id, userName,password ,parentPhone: parentphone , phone ,confirmEmail:true } }, process.env.EMAIL_SIG, { expiresIn: 60 * 120 });
    
   
    const newConfirmEmailToken = jwt.sign({  email }, process.env.EMAIL_SIG);
   
        const link = `${req.protocol}://${req.headers.host}/student/confirmEmail/${token}`
        const requestNewEmailLink = `${req.protocol}://${req.headers.host}/student/newConfirmEmail/${newConfirmEmailToken}`
        const html = `<!DOCTYPE html>
        <html>
        <head>
            <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css"></head>
        <style type="text/css">
        body{background-color: #88BDBF;margin: 0px;}
        </style>
        <body style="margin:0px;"> 
        <table border="0" width="50%" style="margin:auto;padding:30px;background-color: #F3F3F3;border:1px solid #630E2B;">
        <tr>
        <td>
        <table border="0" width="100%">
        <tr>
        <td>
        <h1>
            <img width="100px" src="https://res.cloudinary.com/ddajommsw/image/upload/v1670702280/Group_35052_icaysu.png"/>
        </h1>
        </td>
        <td>
        <p style="text-align: right;"><a href="http://localhost:4200/#/" target="_blank" style="text-decoration: none;">View In Website</a></p>
        </td>
        </tr>
        </table>
        </td>
        </tr>
        <tr>
        <td>
        <table border="0" cellpadding="0" cellspacing="0" style="text-align:center;width:100%;background-color: #fff;">
        <tr>
        <td style="background-color:#630E2B;height:100px;font-size:50px;color:#fff;">
        <img width="50px" height="50px" src="https://res.cloudinary.com/ddajommsw/image/upload/v1670703716/Screenshot_1100_yne3vo.png">
        </td>
        </tr>
        <tr>
        <td>
        <h1 style="padding-top:25px; color:#630E2B">Email Confirmation</h1>
        </td>
        </tr>
        <tr>
        <td>
        <p style="padding:0px 100px;">
        </p>
        </td>
        </tr>
        <tr>
        <td>
        <a href="${link}" style="margin:10px 0px 30px 0px;border-radius:4px;padding:10px 20px;border: 0;color:#fff;background-color:#630E2B; ">Verify Email address</a>
        </td>
        </tr>
        <br>
        <br>
        <br>
        <br>
        <br>
        <br>
        <tr>
        <td>
        <a href="${requestNewEmailLink}" style="margin:10px 0px 30px 0px;border-radius:4px;padding:10px 20px;border: 0;color:#fff;background-color:#630E2B; ">New Verify Email address</a>
        </td>
        </tr>
        </table>
        </td>
        </tr>
        <tr>
        <td>
        <table border="0" width="100%" style="border-radius: 5px;text-align: center;">
        <tr>
        <td>
        <h3 style="margin-top:10px; color:#000">Stay in touch</h3>
        </td>
        </tr>
        <tr>
        <td>
        <div style="margin-top:20px;">
    
        <a href="${process.env.facebookLink}" style="text-decoration: none;"><span class="twit" style="padding:10px 9px;color:#fff;border-radius:50%;">
        <img src="https://res.cloudinary.com/ddajommsw/image/upload/v1670703402/Group35062_erj5dx.png" width="50px" hight="50px"></span></a>
        
        <a href="${process.env.instegram}" style="text-decoration: none;"><span class="twit" style="padding:10px 9px;color:#fff;border-radius:50%;">
        <img src="https://res.cloudinary.com/ddajommsw/image/upload/v1670703402/Group35063_zottpo.png" width="50px" hight="50px"></span>
        </a>
        
        <a href="${process.env.twitterLink}" style="text-decoration: none;"><span class="twit" style="padding:10px 9px;;color:#fff;border-radius:50%;">
        <img src="https://res.cloudinary.com/ddajommsw/image/upload/v1670703402/Group_35064_i8qtfd.png" width="50px" hight="50px"></span>
        </a>
    
        </div>
        </td>
        </tr>
        </table>
        </td>
        </tr>
        </table>
        </body>
        </html>`
     
    const MailSent = await SendMail({ to: email, subject: "Confirmation Email", html })
    if(!MailSent){
          
        return next(new Error ('Email doesn`t Exist '), { cause : 404})
    }
    
    
    
    res.status ( 201). json({Message : 'Done '})
})


export const getMyProfile = asyncHandler(async (req, res, next) => {
    const userId = req.user._id;            
    const isTeacher = req.isteacher?.teacher === true;

    // --- Phase 1: Prepare Queries ---
    // Select the correct model and projection based on the user's role.
    const Model = isTeacher ? teacherModel : studentModel;
    const projection = { password: 0, __v: 0, token: 0 }; // Also hide the token if it exists

    // Build the main profile query. We use .lean() for a significant performance boost.
    let profileQuery = Model.findById(userId).select(projection).lean();

    // Conditionally add population for students. This logic is preserved.
    if (!isTeacher) {
        profileQuery = profileQuery
            .populate({ path: "groupId", select: "groupname", model: "group" }) // Explicitly specify model for clarity
            .populate({ path: "gradeId", select: "grade", model: "grade" });
    }

    // --- Phase 2: Maximum Performance - Parallel Data Fetching ---
    // Execute all independent database queries concurrently.
    const [account, assignmentSubmissions, examSubmissions] = await Promise.all([
        profileQuery,
        SubassignmentModel.find({ studentId: userId }).lean(),
        SubexamModel.find({ studentId: userId }).lean()
    ]);

    // --- Phase 3: Validate & Construct Final Response ---
    if (!account) {
        return next(new Error("Account not found. The user may have been deleted.", { cause: 404 }));
    }

    // Combine the results into a clean, final data object.
    const responseData = {
        ...account, // Spread the main account details
        assignmentSubmissions, // Attach the array of assignment submissions
        examSubmissions,       // Attach the array of exam submissions
    };

    res.status(200).json({
        message: "Profile information fetched successfully.",
        data: responseData,
    });
});

export const Login = asyncHandler(async(req,res,next)=>{
    const {email , password}= req.body;
    const user = await UserModel.findOne({email});
    if(!user){
return next(new Error ('The User Doesn`t exist try to signUp',{cause : 404}))
    }
    const isPassMatch = bycrypt.compareSync(password , user.password) 
    if(!isPassMatch){
        return next(Error('The Password is wrong ', {cause :401 }))
    }
    const token =generateToken({payload : {
        email ,
        password , 
        _id: user._id,
        
        
    },
signature:process.env.SIGN_IN_TOKEN_SECRET,

});
   
   
    res.status(200).json({token});

})



export const getUnassignedByGrade = asyncHandler(async (req, res, next) => {
  const gradeNum = parseInt(req.params.grade, 10);
  if (isNaN(gradeNum)) {
    return next(new Error("Grade must be a number", { cause: 400 }));
  }

  // 1️⃣ Find the Grade doc
  const gradeDoc = await gradeModel.findOne({ grade: gradeNum });
  if (!gradeDoc) {
    return next(new Error(`Grade ${gradeNum} not found`, { cause: 404 }));
  }

  // 2️⃣ Pagination params
  const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
  const skip  = (page - 1) * limit;

  // 3️⃣ Query students in this grade *and* NOT in any group
  const filter = {
    gradeId: gradeDoc._id,         // only this grade :contentReference[oaicite:0]{index=0}
    groupId: null                  // unassigned to any group
  };

  const [ total, students ] = await Promise.all([
    studentModel.countDocuments(filter),
    studentModel
      .find(filter)
      .skip(skip)
      .limit(limit)
      .select("_id userName firstName lastName email")
      .lean()
  ]);

  // 4️⃣ If no students at all in this grade
  if (total === 0) {
    return res.status(200).json({ Message: "No Student Attached to it" });
  }

  // 5️⃣ Response
  res.status(200).json({
    Message:    "Unassigned students fetched successfully",
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    total,
    students
  });
});
export const AdminLogin = asyncHandler(async(req,res,next)=>{
    const {email , password}= req.body;
    const user = await teacherModel.findOne({email});
 
    
    if(!user){
return next(new Error ('The Teacher Doesn`t exist try to signUp',{cause : 404}))
    }
    const isPassMatch = bycrypt.compareSync(password , user.password) 
    if(!isPassMatch){
        return next(Error('The Password is wrong ', {cause :401 }))
    }
    const token =generateToken({payload : {
        email ,
        password , 
        _id: user._id,
        
    },
signature:process.env.SIGN_IN_TOKEN_SECRET,

});

    res.status(200).json({token});

})

