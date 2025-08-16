import rateLimit from 'express-rate-limit';


export const createRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 3, // Allow a user to make 5 course requests per hour
    message: 'You have made too many course requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 70,
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});


export const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,                  // your rule
  message: 'You have made too many lOGIN requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});