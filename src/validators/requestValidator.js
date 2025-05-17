const Joi = require('joi');
const { REQUEST_TYPES, BACKDATED_REQUEST_TYPES } = require('../utility/constants');

// Reusable ObjectId validator
const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

// Schema for backDatedCheckIn details
const backDatedCheckInSchema = Joi.object({
  backdatedCheckInType: Joi.string()
    .valid(BACKDATED_REQUEST_TYPES.full, BACKDATED_REQUEST_TYPES.half)
    .default(BACKDATED_REQUEST_TYPES.full)
    .messages({
      'any.only': `Backdated Check-in Type must be either ${BACKDATED_REQUEST_TYPES.full} or ${BACKDATED_REQUEST_TYPES.half}.`,
    }),
  date: Joi.date().required().messages({
    'any.required': 'Check-in Date is required.',
  }),
}).options({ stripUnknown: true });

// Schema for creating a new request
const createRequestSchema = Joi.object({
  userId: objectIdSchema.required().messages({
    'any.required': 'User ID is required.',
  }),
  requestType: Joi.string()
    .valid(REQUEST_TYPES.backDatedCheckIn, REQUEST_TYPES.ticket)
    .required()
    .messages({
      'any.only': `Request type must be either ${REQUEST_TYPES.backDatedCheckIn} or ${REQUEST_TYPES.ticket}.`,
      'any.required': 'Request type is required.',
    }),
  requestDescription: Joi.string()
    .trim()
    .max(1500)
    .required()
    .messages({
      'string.base': 'Description must be a string.',
      'string.empty': 'Description cannot be empty.',
      'string.max': 'Description should not exceed 1500 characters.',
      'any.required': 'Description is required.',
    }),
  backDatedCheckIn: Joi.when('requestType', {
    is: REQUEST_TYPES.backDatedCheckIn,
    then: backDatedCheckInSchema,
  }),
}).options({ stripUnknown: true });

// Schema to validate request ID from route param
const requestIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Request ID is required.',
  }),
});

// Schema to validate user ID from route param
const userIdSchema = Joi.object({
  userId: objectIdSchema.required().messages({
    'any.required': 'User ID is required.',
  }),
});

// Schema for updating an existing request
const updateRequestSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Request ID is required for update.',
  }),
  requestType: Joi.string()
    .valid(REQUEST_TYPES.backDatedCheckIn, REQUEST_TYPES.ticket)
    .optional()
    .messages({
      'any.only': `Request type must be either ${REQUEST_TYPES.backDatedCheckIn} or ${REQUEST_TYPES.ticket}.`,
    }),
  requestDescription: Joi.string()
    .trim()
    .max(1500)
    .optional()
    .messages({
      'string.base': 'Description must be a string.',
      'string.max': 'Description should not exceed 1500 characters.',
    }),
  backDatedCheckIn: Joi.when('requestType', {
    is: REQUEST_TYPES.backDatedCheckIn,
    then: backDatedCheckInSchema,
  }).optional(),
  status: Joi.string()
    .valid('approved', 'pending', 'rejected')
    .optional()
    .messages({
      'any.only': 'Status must be one of: approved, pending, rejected.',
    }),
  reviewedBy: objectIdSchema.optional().messages({
    'any.invalid': 'Invalid Reviewer User ID.',
  }),
  reviewedAt: Joi.date().optional().messages({
    'date.base': 'Reviewed At must be a valid date.',
  }),
  isDeleted: Joi.boolean().optional().messages({
    'boolean.base': 'Is Deleted must be a boolean value.',
  }),
}).options({ stripUnknown: true });

module.exports = {
  createRequestSchema,
  requestIdSchema,
  userIdSchema,
  updateRequestSchema, // Export the update schema
};