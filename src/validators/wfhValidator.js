const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const createWfhSchema = Joi.object({
  date: Joi.date().required().messages({
    'string.base': 'Wfh date must be a validate date.',
    'any.required': 'Wfh date is required.',
  }),
  wfhReason: Joi.string().trim().min(1).required().messages({
    'string.base': 'Wfh reason should be a string.',
    'string.empty': 'Wfh reason should not be empty.',
    'any.required': 'Wfh reason is required.',
  }),
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
}).options({ stripUnknown: true });

const updateWfhSchema = Joi.object({
  wfhId: objectIdSchema
    .required()
    .messages({ 'any.required': 'WfhId is required.' }),

  status: Joi.string()
    .valid('approved', 'pending', 'rejected', 'revoked')
    .required()
    .messages({
      'string.base': 'Wfh status should be a string.',
      'any.only':
        'Wfh status must be one of approved, pending, rejected, or revoked.',
      'any.required': 'Wfh status is required.',
    }),

  edittorId: objectIdSchema
    .required()
    .messages({ 'any.required': 'edittorId is required.' }),

  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
});

const wfhIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Id is required.',
  }),
});

module.exports = {
  createWfhSchema,
  wfhIdSchema,
  updateWfhSchema,
};
