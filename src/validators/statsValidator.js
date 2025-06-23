const Joi = require('joi');

// ObjectId Schema
const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

// Monthly Stats Schema
const monthlyStatsSchema = Joi.object({
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
}).options({ stripUnknown: true });

// Yearly Stats Schema
const yearlyStatsSchema = Joi.object({
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
}).options({ stripUnknown: true });

// Leave Stats Schema
const leaveStatsSchema = Joi.object({
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
}).options({ stripUnknown: true });

module.exports = {
  monthlyStatsSchema,
  yearlyStatsSchema,
  leaveStatsSchema,
};