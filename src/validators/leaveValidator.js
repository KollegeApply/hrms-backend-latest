const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const createLeaveSchema = Joi.object({
  from: Joi.date().required().messages({
    'date.base': 'Leave start date must be a valid date.',
    'any.required': 'Leave start date is required.',
  }),
  to: Joi.date().optional().allow(null).messages({
    'date.base': 'Leave end date must be a valid date.',
  }),
  leaveReason: Joi.string().trim().min(1).required().messages({
    'string.base': 'Leave reason should be a string.',
    'string.empty': 'Leave reason should not be empty.',
    'any.required': 'Leave reason is required.',
  }),
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
  leaveType: Joi.string().trim().messages({
    'string.base': 'Leave type should be a string.',
  }),
}).options({ stripUnknown: true });

const updateLeaveSchema = Joi.object({
  leaveId: objectIdSchema
    .required()
    .messages({ 'any.required': 'leaveId is required.' }),

  status: Joi.string()
    .valid('tl-pending', 'hr-pending', 'tl-rejected', 'hr-rejected', 'approved', 'auto-rejected', 'revoked')
    .required()
    .messages({
      'string.base': 'leave status should be a string.',
      'any.only':
        'leave status must be one of approved, pending, rejected, or revoked.',
      'any.required': 'leave status is required.',
    }),

  edittorId: objectIdSchema
    .required()
    .messages({ 'any.required': 'edittorId is required.' }),

  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
});

const leaveIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Id is required.',
  }),
});

module.exports = {
  createLeaveSchema,
  leaveIdSchema,
  updateLeaveSchema,
};
