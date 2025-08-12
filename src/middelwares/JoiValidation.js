// middelwares/JoiValidation.js
const Joivalidation = (schema) => {
  return (req, res, next) => {

    const requestData = { ...req.body, ...req.params, ...req.query };
const { error, value } = schema.validate(requestData, {
      abortEarly: true,      
      convert: true,         
    });


    if (error) {
      // Your error reporting style is preserved.
      const errorField = error.details[0].path.join('.'); // e.g., 'body.name' or 'query._id'
      const errorMessage = error.details[0].message;
      
      // Provide a clearer error message
      return res.status(400).json({ message: `Validation error in '${errorField}': ${errorMessage}` });
    }
    req.body = { ...req.body, ...value };

    next();
  };
};

export default Joivalidation;