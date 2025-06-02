// middelwares/JoiValidation.js
const Joivalidation = (schema) => {
  return (req, res, next) => {

    const { error } = schema.validate(req.body, { abortEarly: true });

    if (error) {
     
      const firstMessage = error.details[0];
      return res.status(400).json({ message: firstMessage });
    }

    next();
  };
};

export default Joivalidation;
