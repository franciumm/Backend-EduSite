import rateLimit from 'express-rate-limit';
// New limiter specifically for creating reviews
export const reviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minute window
    max: 10, // Allow a user to make 10 attempts to create a review in 15 mins
    message: 'Too many review creation attempts from this IP. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

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