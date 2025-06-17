export const requestTimeout = (timeoutMs) => {
  return (req, res, next) => {
    let isCompleted = false;

    const timeoutId = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        // This error is sent if the request takes too long.
        next(new Error(`Request timed out after ${timeoutMs}ms. Please try again.`, { cause: 503 })); // 503 Service Unavailable
      }
    }, timeoutMs);

    // Override res.end to clear the timeout when the response is sent.
    const originalEnd = res.end;
    res.end = function (...args) {
      if (!isCompleted) {
        isCompleted = true;
        clearTimeout(timeoutId);
        originalEnd.apply(this, args);
      }
    };
    next();
  };
};