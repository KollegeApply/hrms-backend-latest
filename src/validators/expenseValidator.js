const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const allowedTypes = ['Travel', 'Food', 'Stay', 'Miscellaneous'];
const allowedActions = ['approved', 'rejected'];
const miscellaneousWordLimit = 20;

const countWords = (value = '') =>
  String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const createExpenseSchema = Joi.object({
  date: Joi.date().required().messages({
    'date.base': 'Expense date must be a valid date.',
    'any.required': 'Expense date is required.',
  }),
  name: Joi.string()
    .trim()
    .max(100)
    .pattern(/^[a-zA-Z0-9\s.,&()-]+$/)
    .required()
    .messages({
      'string.empty': 'Expense name is required.',
      'string.max': 'Expense name cannot exceed 100 characters.',
      'string.pattern.base':
        'Expense name contains unsupported special characters.',
    }),
  type: Joi.string()
    .valid(...allowedTypes)
    .required()
    .messages({
      'any.only': `Expense type must be one of: ${allowedTypes.join(', ')}`,
      'any.required': 'Expense type is required.',
    }),
  miscellaneousType: Joi.when('type', {
    is: 'Miscellaneous',
    then: Joi.string()
      .trim()
      .max(100)
      .custom((value, helpers) => {
        if (countWords(value) > miscellaneousWordLimit) {
          return helpers.error('string.maxWords');
        }
        return value;
      }, 'Miscellaneous Type word limit')
      .required()
      .messages({
        'string.empty': 'Miscellaneous detail is required.',
        'string.max': 'Miscellaneous detail cannot exceed 100 characters.',
        'string.maxWords': `Miscellaneous detail cannot exceed ${miscellaneousWordLimit} words.`,
        'any.required': 'Miscellaneous detail is required for Miscellaneous type.',
      }),
    otherwise: Joi.string().trim().allow('', null).optional(),
  }),
  amount: Joi.number().precision(2).greater(0).required().messages({
    'number.base': 'Amount must be a valid number.',
    'number.greater': 'Amount must be greater than 0.',
    'any.required': 'Amount is required.',
  }),
  purpose: Joi.string().trim().max(500).required().messages({
    'string.empty': 'Purpose is required.',
    'string.max': 'Purpose cannot exceed 500 characters.',
    'any.required': 'Purpose is required.',
  }),
  // Full HTTPS URL or S3-relative key from upload (e.g. hrms-expenses/...)
  attachmentUrl: Joi.string()
    .trim()
    .max(500)
    .allow(null, '')
    .optional()
    .messages({
      'string.max': 'Attachment URL cannot exceed 500 characters.',
    }),
}).options({ stripUnknown: true });

const listExpenseSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().trim().allow(''),
  type: Joi.string().trim().allow(''),
  fromDate: Joi.date(),
  toDate: Joi.date(),
  queue: Joi.string().trim().valid('team', 'finance').optional(),
  search: Joi.string().trim().allow(''),
}).options({ stripUnknown: true });

const expenseIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Expense id is required.',
  }),
});

const updateExpenseStatusSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'Expense id is required.',
  }),
  action: Joi.string()
    .valid(...allowedActions)
    .required()
    .messages({
      'any.required': 'Action is required.',
      'any.only': `Action must be one of: ${allowedActions.join(', ')}`,
    }),
  remark: Joi.string().trim().max(500).allow('', null).messages({
    'string.max': 'Remark cannot exceed 500 characters.',
  }),
}).options({ stripUnknown: true });

module.exports = {
  createExpenseSchema,
  listExpenseSchema,
  expenseIdSchema,
  updateExpenseStatusSchema,
};
