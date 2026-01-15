const Joi = require('joi');

const sosRequestSchema = Joi.object({
  disasterId: Joi.string().required(),
  requestedBy: Joi.string().required(),
  requiredSkills: Joi.array().items(Joi.string()).optional(),
  requiredResources: Joi.array().items(Joi.string()).optional(),
  urgency: Joi.string().valid('critical', 'high', 'medium', 'low').required(),
  numberOfPeople: Joi.number().integer().min(1).optional(),
  location: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }).required(),
  description: Joi.string().optional(),
  contactPhone: Joi.string().optional(),
});

function validateSOSRequest(req, res, next) {
  const { error, value } = sosRequestSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.details.map((d) => d.message),
      },
    });
  }

  req.body = value;
  next();
}

module.exports = { validateSOSRequest };
