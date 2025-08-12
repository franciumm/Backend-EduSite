// utils/erroHandling.js

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


export const notFound = (req, res) => {
  return res.status(404).json({
    success: false,
    error: { message: 'Not Found', path: req.originalUrl, reqId: req.id },
  });
};

export const globalerrorHandling = (err, req, res, next) => {
  console.error(err);
  res
    .status(err.cause || 500)
    .json({ message: err.message });
};
