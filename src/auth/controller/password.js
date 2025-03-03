import  UserModel  from "../../../DB/models/student.model.js";
import { asyncHandler } from "../../utils/erroHandling.js";
import jwt  from "jsonwebtoken";
import bycrypt from 'bcrypt'
import SendMail from "../../utils/Mailer.js";
import  mongoose from "mongoose";


export const forgetPassword = asyncHandler(async (req,res,next)=>{
    const {email}= req.body;
    
    const user = await UserModel.findOne({email})
    
    if(!user){
        return next (new Error('Invalid Email', { cause : 400}))
    }
    const hashId = new mongoose.Types.ObjectId().toString();
    const Hash =  bycrypt.hashSync(hashId, parseInt(process.env.HASH_ROUNDS));
    const token = jwt.sign({ email , Hash}, process.env.RESET_SIG, { expiresIn: 60 * 5 });
    const ResetLink = `${req.protocol}://${req.headers.host}/student/reset/${token}`
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
    <p style="text-align: right;"><a href="http://localhost:5000/#/" target="_blank" style="text-decoration: none;">View In Website</a></p>
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
    <h1 style="padding-top:25px; color:#630E2B">Password Reset</h1>
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
    <a href="${ResetLink}" style="margin:10px 0px 30px 0px;border-radius:4px;padding:10px 20px;border: 0;color:#fff;background-color:#630E2B; "> Reset Password </a>
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

    const isEmailSent =await SendMail({ to: email, subject: "Reset Password Email", html });
    if(!isEmailSent ){
        return next(new Error('Failed to send', {cause:400}))
    }
    const UserUpdate = await UserModel.findOneAndUpdate({email},{frogetPass:Hash}, {new:true});
    res.status(200).json({message:'Done', UserUpdate})
})






export const ResetPassword = asyncHandler(async (req,res,next)=>{
    const {token}= req.params;
    const decoded = jwt.verify(token, process.env.RESET_SIG);


    const user = await UserModel.findOne({email: decoded.email, frogetPass : decoded.hashId})
    if(!user){
        return next (new Error('You have Already Reset Your Pass Yngm', { cause : 400}))
    }
    
    const {newPassword,CPassword} = req.body ;

    if(newPassword != CPassword ){
    return new Error('Please make Sure to confirm The Password ', {cause :400})
    }   

    const hashPassword = bycrypt.hashSync(newPassword, parseInt(process.env.HASH_ROUNDS));
    user.password = hashPassword; 
    user.frogetPass = null ;
    await user.save();

    res.status(200).json({message:'Done', user});
})