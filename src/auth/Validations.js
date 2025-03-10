import Joi from "joi";
import mongoose from "mongoose";

export const  signup = Joi.object({
    userName : Joi.string().min(2).max(20).required(),
    firstName:Joi.string().required(),
    lastName:Joi.string().required(),
    email:Joi.string().email({ minDomainSegments: 2,maxDomainSegments:3, tlds: { allow: ['com', 'net','eg','edu'] } }).required(),
    parentemail:Joi.string().email({ minDomainSegments: 2,maxDomainSegments:3, tlds: { allow: ['com', 'net','eg','edu'] } }).required(),
    password:Joi.string().pattern(new RegExp(/^[a-zA-Z0-9]{3,30}$/)).required(),
    cPassword: Joi.string().valid(Joi.ref('password')).required(),
    phone: Joi.string().max(13).min(10).required(),
    parentphone: Joi.string().max(13).min(10).required(),
   
    gradeid : Joi.string().custom((value, helpers) => {  if (!mongoose.Types.ObjectId.isValid(value)) {  return helpers.message("Invalid ObjectId");  }    return value; }, "ObjectId Validation")

}).required()


export const  Login = Joi.object({
    email:Joi.string().email({ minDomainSegments: 2,maxDomainSegments:3, tlds: { allow: ['com', 'net','eg','edu'] } }).required(),
    password:Joi.string().pattern(new RegExp(/^[a-zA-Z0-9]{3,30}$/)).required(),

}).required()
