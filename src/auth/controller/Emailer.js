import  UserModel  from "../../../DB/models/student.model.js";
import SendMail from "../../utils/Mailer.js";
import { asyncHandler } from "../../utils/erroHandling.js";
import jwt  from "jsonwebtoken";
import bycrypt from 'bcrypt'
import { gradeModel } from "../../../DB/models/grades.model.js";


export const confirmEmail = asyncHandler(async (req,res,next)=>{
const tokenDec =  jwt.verify(req.params.email, process.env.EMAIL_SIG);
const userif = await UserModel.findOne({$or :[{email:tokenDec.email},{userName :tokenDec.user.userName },{phone :tokenDec.user.phone }]});
if(userif && userif.confirmEmail == true ){return res.redirect(`${req.protocol}://${req.headers.host}/EduSite/#/login`)}
tokenDec.user.password = bycrypt.hashSync(tokenDec.user.password, parseInt(process.env.HASH_ROUNDS));

const usercreated =await  UserModel.create(tokenDec.user);
const gradee = await gradeModel.findById(tokenDec.user.gradeId);
gradee.enrolledStudents.push(usercreated._id);
await gradee.save();
usercreated.save();

return usercreated ? res.redirect(`${req.protocol}://${req.headers.host}/student/login`) : res.send(`<a href="${req.protocol}://${req.headers.host}/student/signup">Ops looks like u don't have account yet follow me to signup now. </a>`)
})


export const newConfirmEmail = asyncHandler(async (req,res,next)=>{
    
    const tokenDec = jwt.verify(req.params.email, process.env.EMAIL_SIG);
    const user = await UserModel.findOne({email : tokenDec.email.toLowerCase()});
    if (!user) {return res.send(`<a href="${req.protocol}://${req.headers.host}/EduSite/#/signup">Ops looks like u don't have account yet follow me to signup now. </a>`)}
    if(user.isdeleted ){return next(new Error('This Email is deleted Please Login Again ', {cause : 400}))}
    const newToken = jwt.sign({email: user.email,user}, process.env.EMAIL_SIG, { expiresIn: 60 * 2 })
    const link = `${req.protocol}://${req.headers.host}/student/confirmEmail/${newToken}`
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


    await SendMail({ to: user.email, subject: "Confirmation Email", html })
    return res.send(`<p>Check your inbox now</p>`)

})

