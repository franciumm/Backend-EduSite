import Joi from "joi";

export const reportQuerySchema = Joi.object({
  studentId: Joi.string().length(24).hex().required(),

  // Date range A: explicit ISO dates
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),

  // Date range B: month-to-month within a year
  year: Joi.number().integer().min(2000).max(2100).optional(),
  fromMonth: Joi.number().integer().min(1).max(12).optional(),
  toMonth: Joi.number().integer().min(1).max(12).optional(),

  // Output
  format: Joi.string().valid("pdf", "xlsx").default("pdf"),

  // Optional timezone string if you want, otherwise server TZ
  tz: Joi.string().optional()
})
.custom((val, helpers) => {
  const hasA = val.from || val.to;
  const hasB = val.year || val.fromMonth || val.toMonth;

  if (hasA && (!val.from || !val.to))
    return helpers.error("any.invalid", { message: "Provide both 'from' and 'to' or use months." });

  if ((val.fromMonth || val.toMonth) && !val.year)
    return helpers.error("any.invalid", { message: "Provide 'year' with fromMonth/toMonth." });

  if (!hasA && !hasB) {
    // Allow default range (current year); controller will fill it.
  }
  if (val.fromMonth && val.toMonth && val.fromMonth > val.toMonth)
    return helpers.error("any.invalid", { message: "'fromMonth' cannot be greater than 'toMonth'." });

  return val;
});

