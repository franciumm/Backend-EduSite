import Joi from 'joi';

export const createCourseSchema = Joi.object({
    // courseName: Must be a string, at least 3 characters, max 100, and is required.
    courseName: Joi.string().min(3).max(100).required(),

    // name: Must be a string, at least 2 characters, max 50, and is required.
    name: Joi.string().min(2).max(50).required(),

    // email: Must be a string in a valid email format (toplevel domain like .com required), and is required.
    email: Joi.string().email({ tlds: { allow: true } }).required(),

    // phone: Using a string with a regex is better for phone numbers.
    // This example regex is for an 11-digit Egyptian mobile number (e.g., 01xxxxxxxxx).
    phone: Joi.string().pattern(/^01[0125][0-9]{8}$/).required().messages({
        'string.pattern.base': 'Phone number must be a valid 11-digit Egyptian mobile number.'
    }),

    // grade: Must be a positive integer (e.g., a school grade) and is required.
    grade: Joi.number().integer().positive().required(),

    // description: An optional string, with a maximum length of 500 characters.
    description: Joi.string().max(500).optional(),
}).required(); // The entire request body object is required.