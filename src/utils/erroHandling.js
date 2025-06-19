// utils/erroHandling.js

/**
 * Wraps an async controller and pipes any thrown error
 * directly to Express’s error middleware.
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise
      .resolve(fn(req, res, next))
      .catch(err => {
        // ensure there’s a numeric cause if you want one
        if (!err.cause) err.cause = 500;
        next(err);
      });
  };
};

/**
 * Global error middleware. Must be registered *after* all routes:
 * app.use(globalerrorHandling)
 */
export const globalerrorHandling = (err, req, res, next) => {
  console.error(err);
  res
    .status(err.cause || 500)
    .json({ message: err.message });
};
