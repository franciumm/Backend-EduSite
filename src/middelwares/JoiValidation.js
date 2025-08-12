// middelwares/JoiValidation.js
const Joivalidation = (schema, where = "merged") => (req, res, next) => {
  // 1) Pick source to validate
  let data;
  switch (where) {
    case "headers": data = req.headers; break;
    case "query":   data = req.query;   break;
    case "params":  data = req.params;  break;
    case "body":    data = req.body;    break;
    default:        data = { ...req.body, ...req.params, ...req.query };
  }

  // 2) Validate (allow unknown only for headers)
  const { error, value } = schema.validate(data, {
    abortEarly: true,
    convert: true,
    allowUnknown: where === "headers",
    // strip extra keys for non-header payloads (optional but nice)
    stripUnknown: where !== "headers",
  });

  if (error) {
    const field = error.details?.[0]?.path?.join(".") || "validation";
    const msg = error.details?.[0]?.message || "Invalid request";
    return res.status(400).json({ message: `Validation error in '${field}': ${msg}` });
  }

  // 3) Write sanitized values back ONLY to the same place
  if (where === "headers") {
    // update only what you validated (e.g., authorization)
    if (value.authorization) req.headers.authorization = value.authorization;
  } else if (where === "query")   req.query  = value;
    else if (where === "params")  req.params = value;
    else if (where === "body")    req.body   = value;
    else                          req.body   = { ...req.body, ...value };

  next();
};

export default Joivalidation;
