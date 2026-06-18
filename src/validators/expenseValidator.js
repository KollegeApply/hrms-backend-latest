const Joi = require('joi');
const {
  EXPENSE_TYPES_CREATE,
  TRAVEL_SUBCATEGORIES,
  FOOD_SUBCATEGORIES,
  MISCELLANEOUS_SUBCATEGORIES,
} = require('../utility/expensePolicyConstants');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const allowedActions = ['approved', 'rejected'];

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
    .valid(...EXPENSE_TYPES_CREATE)
    .required()
    .messages({
      'any.only': `Expense type must be one of: ${EXPENSE_TYPES_CREATE.join(', ')}`,
      'any.required': 'Expense type is required.',
    }),
  subCategory: Joi.string().trim().max(120).allow('', null).optional(),
  distanceKm: Joi.number().min(0).allow(null).optional(),
  clientName: Joi.string().trim().max(100).allow('', null).optional(),
  clientPocName: Joi.string().trim().max(100).allow('', null).optional(),
  clientPocDesignation: Joi.string().trim().max(100).allow('', null).optional(),
  attendeeUserIds: Joi.array().items(objectIdSchema).max(200).optional(),
  miscOthersDescription: Joi.string().trim().max(300).allow('', null).optional(),
  travelMiscDescription: Joi.string().trim().max(200).allow('', null).optional(),
  cityTier: Joi.string().valid('Metro', 'Non-Metro').allow('', null).optional(),
  miscellaneousType: Joi.string().trim().max(200).allow('', null).optional(),
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
  attachmentUrl: Joi.string()
    .trim()
    .max(500)
    .allow(null, '')
    .optional()
    .messages({
      'string.max': 'Attachment URL cannot exceed 500 characters.',
    }),
})
  .custom((value, helpers) => {
    const { type, subCategory, distanceKm, attendeeUserIds } = value;

    if (type === 'Travel') {
      if (!subCategory || !TRAVEL_SUBCATEGORIES.includes(subCategory)) {
        return helpers.message({
          custom: `Travel requires subCategory to be one of: ${TRAVEL_SUBCATEGORIES.join(', ')}`,
        });
      }
      if (subCategory === '2 Wheeler' || subCategory === '4 Wheeler') {
        if (distanceKm == null || Number(distanceKm) <= 0) {
          return helpers.message({
            custom:
              'Distance (km) is required and must be greater than 0 for 2 Wheeler / 4 Wheeler.',
          });
        }
      }
      if (subCategory === 'Misc') {
        const desc = (value.travelMiscDescription || '').trim();
        if (!desc) {
          return helpers.message({
            custom: 'Description is required for Travel > Misc (max 200 characters).',
          });
        }
      }
    }

    if (type === 'Food') {
      if (!subCategory || !FOOD_SUBCATEGORIES.includes(subCategory)) {
        return helpers.message({
          custom: `Food requires subCategory to be one of: ${FOOD_SUBCATEGORIES.join(', ')}`,
        });
      }
    }

    if (type === 'Miscellaneous') {
      if (!subCategory || !MISCELLANEOUS_SUBCATEGORIES.includes(subCategory)) {
        return helpers.message({
          custom: `Miscellaneous requires subCategory to be one of: ${MISCELLANEOUS_SUBCATEGORIES.join(', ')}`,
        });
      }
      if (subCategory === 'Hotel Accommodation') {
        if (!value.cityTier || !['Metro', 'Non-Metro'].includes(value.cityTier)) {
          return helpers.message({
            custom:
              'cityTier is required for Hotel Accommodation and must be Metro or Non-Metro.',
          });
        }
      }
      if (subCategory === 'Others') {
        const d = (value.miscOthersDescription || '').trim();
        if (!d) {
          return helpers.message({
            custom:
              'Description is required for Miscellaneous > Others (max 300 characters).',
          });
        }
      }
      if (subCategory === 'Client Gifting' || subCategory === 'Client Lunch') {
        if (!(value.clientName || '').trim()) {
          return helpers.message({ custom: 'Client Name is required.' });
        }
        if (!(value.clientPocName || '').trim()) {
          return helpers.message({ custom: 'POC Name is required.' });
        }
        if (!(value.clientPocDesignation || '').trim()) {
          return helpers.message({ custom: 'POC Designation is required.' });
        }
      }
    }

    if (type === 'Team Lunch') {
      if (!Array.isArray(attendeeUserIds) || attendeeUserIds.length < 1) {
        return helpers.message({
          custom: 'Team Lunch requires at least one attendee (attendeeUserIds).',
        });
      }
    }

    if (
      type !== 'Travel' &&
      type !== 'Food' &&
      type !== 'Miscellaneous' &&
      subCategory
    ) {
      return helpers.message({
        custom: 'subCategory must only be sent for Travel, Food, or Miscellaneous.',
      });
    }

    if (value.cityTier) {
      if (!(type === 'Miscellaneous' && subCategory === 'Hotel Accommodation')) {
        return helpers.message({
          custom: 'cityTier is only allowed for Miscellaneous > Hotel Accommodation.',
        });
      }
    }

    return value;
  }, 'Phase 2 expense cross-field rules')
  .options({ stripUnknown: true });

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
  remark: Joi.when('action', {
    is: 'approved',
    then: Joi.string()
      .trim()
      .min(8)
      .max(500)
      .required()
      .messages({
        'string.min': 'Approval remarks must be at least 8 characters.',
        'any.required': 'Approval remarks are required.',
        'string.empty': 'Approval remarks are required.',
      }),
    otherwise: Joi.string()
      .trim()
      .min(10)
      .max(500)
      .required()
      .messages({
        'string.min': 'Rejection reason must be at least 10 characters.',
        'any.required': 'Rejection reason is required.',
        'string.empty': 'Rejection reason is required.',
      }),
  }),
}).options({ stripUnknown: true });

const bulkApproveExpenseSchema = Joi.object({
  expenseIds: Joi.array()
    .items(objectIdSchema)
    .min(1)
    .max(50)
    .unique()
    .required()
    .messages({
      'array.min': 'At least one expense id is required.',
      'array.max': 'You can approve up to 50 expenses at once.',
      'any.required': 'Expense ids are required.',
    }),
  remark: Joi.string()
    .trim()
    .min(8)
    .max(500)
    .required()
    .messages({
      'string.min': 'Approval remarks must be at least 8 characters.',
      'any.required': 'Approval remarks are required.',
      'string.empty': 'Approval remarks are required.',
    }),
  sendMail: Joi.boolean().optional(),
}).options({ stripUnknown: true });

const expenseDashboardSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required().messages({
    'any.required': 'Month is required.',
    'number.min': 'Month must be between 1 and 12.',
    'number.max': 'Month must be between 1 and 12.',
  }),
  year: Joi.number().integer().min(2000).max(2100).required().messages({
    'any.required': 'Year is required.',
  }),
  team: Joi.string().trim().allow('').optional(),
  employeeId: Joi.alternatives()
    .try(objectIdSchema, Joi.string().trim().min(1))
    .optional()
    .messages({
      'alternatives.match': 'employeeId must be a valid user id or employee code.',
    }),
  status: Joi.string().trim().allow('').optional(),
  groupBy: Joi.string().valid('employee', 'department').default('employee'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(10000).default(10),
}).options({ stripUnknown: true });

const bulkRejectExpenseSchema = Joi.object({
  expenseIds: Joi.array()
    .items(objectIdSchema)
    .min(1)
    .max(50)
    .unique()
    .required()
    .messages({
      'array.min': 'At least one expense id is required.',
      'array.max': 'You can reject up to 50 expenses at once.',
      'any.required': 'Expense ids are required.',
    }),
  remark: Joi.string()
    .trim()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'Rejection reason must be at least 10 characters.',
      'any.required': 'Rejection reason is required.',
      'string.empty': 'Rejection reason is required.',
    }),
  sendMail: Joi.boolean().optional(),
}).options({ stripUnknown: true });

module.exports = {
  createExpenseSchema,
  listExpenseSchema,
  expenseDashboardSchema,
  expenseIdSchema,
  updateExpenseStatusSchema,
  bulkApproveExpenseSchema,
  bulkRejectExpenseSchema,
};
