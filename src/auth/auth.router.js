import {Router} from 'express';
import * as UserStart from './controller/User.Start.js'
import * as UserMailConfirm from './controller/Emailer.js'
import * as Joi from './Validations.js'
import Joivalidation from '../middelwares/JoiValidation.js';
import * as PasswordC from './controller/password.js'
import { isAuth ,AdminAuth  } from '../middelwares/auth.js';
import { loginLimiter } from '../middelwares/ratelimiter.js';
const router = Router ();


router.post ('/signup',Joivalidation(Joi.signup),UserStart.Signup);
router.get('/confirmEmail/:email', UserMailConfirm.confirmEmail);
router.get('/newConfirmEmail/:email',UserMailConfirm.newConfirmEmail);
router.post('/login',loginLimiter,Joivalidation(Joi.Login),UserStart.Login );
router.post('/teacher/login',Joivalidation(Joi.Login),UserStart.AdminLogin );
router.post ('/forget',PasswordC.forgetPassword);
router.post ('/reset/:token',PasswordC.ResetPassword);
router.get("/profile", isAuth , UserStart.getMyProfile);
router.get("/grade/:grade/unassigned",AdminAuth,UserStart.getUnassignedByGrade);


export default router;
