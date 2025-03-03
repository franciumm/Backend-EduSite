import  UserModel  from "../../../DB/models/student.model.js";
import { asyncHandler } from "../../utils/erroHandling.js";
import jwt from 'jsonwebtoken'
import bycrypt from 'bcrypt'
import SendMail from "../../utils/Mailer.js";
import { generateToken } from "../../utils/tokenFunctions.js";
import { teacherModel } from "../../../DB/models/teacher.model.js";
import { gradeModel } from "../../../DB/models/grades.model.js";
export const Signup = asyncHandler(async(req,res,next)=>{
    const {email,parentemail,userName,firstName,lastName,password,gradeid ,  parentphone ,phone,cPassword}= req.body ;
    
    if(await UserModel.findOne({$or:[{email},{userName},{phone}]})){
        return next( Error('User Email or Username or phone Exists', {cause:409}));
    }
     
    if(!(await gradeModel.findById(gradeid))){
        return next( Error('Invalid Grade Id ', {cause:409}));
    }
    if(password != cPassword){
        return next( Error('Password Doesn`t match'), {cause:403});
    }
    
  
    const token = jwt.sign({  email, user:{firstName,lastName,email,parentemail,gradeId: gradeid, userName,password ,parentPhone: parentphone , phone ,confirmEmail:true } }, process.env.EMAIL_SIG, { expiresIn: 60 * 5 });

   
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

