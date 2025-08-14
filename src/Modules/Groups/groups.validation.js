import Joi from 'joi';

// A reusable schema for validating MongoDB ObjectIDs.
const objectId = Joi.string().hex().length(24);

// A reusable schema for validating headers to ensure the authorization token is present.
export const headers = Joi.object({
  authorization: Joi.string()
    .required()
    .pattern(/^(MonaEdu)\s+[A-Za-z0-9\-_]+=*\.[A-Za-z0-9\-_]+=*\.[A-Za-z0-9\-_]+=*$/)
}).unknown(true);
export const createGroup = Joi.object({
    grade: Joi.number().required(),
    groupname: Joi.string().required().min(1).max(100)
});



export const getGroupByGrade = Joi.object({
    grade: Joi.number().required()
});

export const getGroupById = Joi.object({
    _id: objectId.required()
});

export const deleteGroup = Joi.object({
    groupid: objectId.required()
});

export const addOrRemoveStudent = Joi.object({
    groupid: objectId.required(),
    studentid: objectId.required()
});

export const manageInviteLink = Joi.object({
    groupid: objectId.required()
});

export const joinWithInviteLink = Joi.object({
    inviteToken: Joi.string().hex().length(40).required()
});

export const getInviteLink = Joi.object({
    groupid: objectId.required()
});