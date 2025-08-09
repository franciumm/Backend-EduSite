// middelwares/JoiValidation.js
const Joivalidation = (schema) => {
  return (req, res, next) => {
    // Combine all request inputs into a single object to be validated.
    const requestData = { ...req.body, ...req.params, ...req.query };

    const { error } = schema.validate(requestData, { abortEarly: true });

    if (error) {
      // Your error reporting style is preserved.
      const errorField = error.details[0].path.join('.'); // e.g., 'body.name' or 'query._id'
      const errorMessage = error.details[0].message;
      
      // Provide a clearer error message
      return res.status(400).json({ message: `Validation error in '${errorField}': ${errorMessage}` });
    }

    next();
  };
};

export default Joivalidation;