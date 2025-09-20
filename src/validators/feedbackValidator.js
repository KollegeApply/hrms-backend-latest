const Joi = require('joi');

const createFeedbackValidator = Joi.object({
  givenTo: Joi.string().required().label("Given To"),
  // Period-based feedback (new system)
  periodId: Joi.string().optional().label("Period ID"),
  periodType: Joi.string().valid('monthly', 'biweekly').optional().label("Period Type"),
  // Date-based feedback (legacy system)
  from: Joi.date().iso().optional().label("From Date"),
  to: Joi.date().iso().optional().label("To Date"),
  feedback: Joi.string().required().label("Feedback"),
  rating: Joi.alternatives().try(
    // Legacy format support
    Joi.object({
      discipline: Joi.number().min(1).max(5).optional(),
      initiative: Joi.number().min(1).max(5).optional(),
      teamwork: Joi.number().min(1).max(5).optional(),
      ownership: Joi.number().min(1).max(5).optional(),
      skillDevelopment: Joi.number().min(1).max(5).optional(),
      techSkills: Joi.number().min(1).max(5).optional(),
      overall: Joi.number().min(1).max(5).optional(),
    }).min(1), // At least one rating required
    // New KPI format support - dynamic key-value pairs
    Joi.object().pattern(
      Joi.string(), // KPI name
      Joi.number().min(0).max(5) // Rating value (0 is valid - unrated)
    ).min(1) // At least one rating required
  ).required(),
  // AI Analysis fields (added by middleware)
  sentiment: Joi.string().valid('Positive', 'Neutral', 'Negative').optional(),
  sentimentScore: Joi.number().min(0).max(100).optional(),
  keywords: Joi.array().items(Joi.string()).optional(),
  recommendation: Joi.string().allow('').optional()
}).custom((value, helpers) => {
  // Ensure either periodId or from/to dates are provided
  const hasPeriodId = value.periodId;
  const hasFromTo = value.from && value.to;
  
  if (!hasPeriodId && !hasFromTo) {
    return helpers.error('any.custom', { 
      message: 'Either periodId or both from and to dates are required' 
    });
  }
  
  return value;
});


const updateFeedbackValidator = Joi.object({
  from: Joi.date().iso().optional().label("From Date"),
  to: Joi.date().iso().optional().label("To Date"),
  feedback: Joi.string().optional().label("Feedback"),
  givenTo: Joi.string().optional().label("Given To"),
  rating: Joi.object({
    discipline: Joi.number().min(1).max(5).optional(),
    initiative: Joi.number().min(1).max(5).optional(),
    teamwork: Joi.number().min(1).max(5).optional(),
    ownership: Joi.number().min(1).max(5).optional(),
    skillDevelopment: Joi.number().min(1).max(5).optional(),
    techSkills: Joi.number().min(1).max(5).optional(),
    overall: Joi.number().min(1).max(5).optional(),
  }).optional(),
  concernRaised: Joi.boolean().optional(),
  concernReason: Joi.string().optional(),
  // AI Analysis fields (optional for updates)
  sentiment: Joi.string().valid('Positive', 'Neutral', 'Negative').optional(),
  sentimentScore: Joi.number().min(0).max(100).optional(),
  keywords: Joi.array().items(Joi.string()).optional(),
  recommendation: Joi.string().allow('').optional()
});


module.exports = {
    createFeedbackValidator,
    updateFeedbackValidator,
}
