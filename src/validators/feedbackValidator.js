const Joi = require('joi');

const createFeedbackValidator = Joi.object({
  givenTo: Joi.string().required().label("Given To"),
  from: Joi.date().iso().required().label("From Date"),
  to: Joi.date().iso().required().label("To Date"),
  feedback: Joi.string().required().label("Feedback"),
  rating: Joi.object({
    discipline: Joi.number().min(1).max(5).required(),
    initiative: Joi.number().min(1).max(5).required(),
    teamwork: Joi.number().min(1).max(5).required(),
    ownership: Joi.number().min(1).max(5).required(),
    skillDevelopment: Joi.number().min(1).max(5).required(),
    techSkills: Joi.number().min(1).max(5).optional(),
    overall: Joi.number().min(1).max(5).optional(),
  }).required(),
  concernRaised: Joi.boolean().optional(),
  concernReason: Joi.string().optional(),
  // AI Analysis fields (added by middleware)
  sentiment: Joi.string().valid('Positive', 'Neutral', 'Negative').optional(),
  sentimentScore: Joi.number().min(0).max(100).optional(),
  keywords: Joi.array().items(Joi.string()).optional(),
  recommendation: Joi.string().allow('').optional()
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
