// file: validators/assetValidator.js
const Joi = require('joi');
const {
  VALID_ASSETS_STATUS,
  VALID_LAPTOP_TYPES,
  VALID_ASSET_CATEGORIES,
  VALID_ASSET_REQUEST_STATUS,
  VALID_ASSET_ASSIGNMENT_TYPES,
  VALID_ASSET_CONDITIONS,
  VALID_ASSET_INVENTORY_STATUS,
  VALID_ASSET_INVENTORY_CREATE_STATUS,
} = require('../utility/constants');


const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const mongoId24 = Joi.string()
  .length(24)
  .pattern(/^[a-fA-F0-9]+$/);

const assetAssignmentSchema = Joi.object({
  // When assigning from inventory, type/name come from DB; omit from body.
  inventoryAssetId: objectIdSchema.optional(),
  assetType: Joi.when('inventoryAssetId', {
    is: mongoId24,
    then: Joi.string().optional().allow('', null),
    otherwise: Joi.string().required().messages({
      'string.empty': 'Asset Type is required',
      'any.required': 'Asset Type is required',
    }),
  }),
  assetName: Joi.when('inventoryAssetId', {
    is: mongoId24,
    then: Joi.string().optional().allow('', null),
    otherwise: Joi.string().required().messages({
      'string.empty': 'Asset Name is required',
      'any.required': 'Asset Name is required',
    }),
  }),
  assignee: Joi.string().required().messages({
    'string.empty': 'Assignee (Employee ID) is required',
    'any.required': 'Assignee (Employee ID)  is required',
  }),
  serialNumber: Joi.string().optional().allow(''),
  specifications: Joi.string().optional().allow(''),
  assignedBy: Joi.string().required().messages({
    'string.empty': 'Assigned By (User ID) is required',
    'any.required': 'Assigned By (User ID) is required',
  }),
  assignmentType: Joi.string()
    .valid(...VALID_ASSET_ASSIGNMENT_TYPES)
    .optional()
    .default('permanent')
    .messages({
      'any.only': `Assignment Type must be one of: ${VALID_ASSET_ASSIGNMENT_TYPES.join(', ')}`,
    }),
  temporaryUntil: Joi.when('assignmentType', {
    is: 'temporary',
    then: Joi.date().required().messages({
      'any.required': 'Temporary until date is required for temporary assignment',
      'date.base': 'Temporary until must be a valid date',
    }),
    otherwise: Joi.any().strip(),
  }),
  status: Joi.string()
    .required()
    .valid(...VALID_ASSETS_STATUS)
    .messages({
      'any.only': `Status must be one of the following: ${VALID_ASSETS_STATUS.join(', ')}`,
    }),
  sendMail: Joi.boolean().optional(),
  laptopType: Joi.string().optional().allow('').custom((value, helpers) => {
    const parent = helpers.state.ancestors[0];
    const invId = parent?.inventoryAssetId;
    if (invId && /^[a-fA-F0-9]{24}$/.test(invId)) return value;
    const assetType = parent?.assetType;
    if (assetType === 'laptop') {
      if (!VALID_LAPTOP_TYPES.includes(value)) {
        return helpers.error('any.only');
      }
    }
    return value;
  }).messages({
    'any.only': `Laptop Type must be one of: ${VALID_LAPTOP_TYPES.join(', ')}`,
  }),
}).options({ stripUnknown: true });

const createAssetInventorySchema = Joi.object({
  assetType: Joi.string().required(),
  laptopType: Joi.string().optional().allow('').custom((value, helpers) => {
    const assetType = helpers.state.ancestors[0]?.assetType;
    if (assetType?.toLowerCase() === 'laptop') {
      if (!VALID_LAPTOP_TYPES.includes(value)) return helpers.error('any.only');
    }
    return value;
  }).messages({
    'any.only': `Laptop Type must be one of: ${VALID_LAPTOP_TYPES.join(', ')}`,
  }),
  assetCategory: Joi.string()
    .required()
    .valid(...VALID_ASSET_CATEGORIES)
    .messages({
      'string.empty': 'Primary Asset Type is required',
      'any.required': 'Primary Asset Type is required',
      'any.only': `Primary Asset Type must be one of: ${VALID_ASSET_CATEGORIES.join(', ')}`,
    }),
  assetName: Joi.string().required(),
  brand: Joi.string().required(),
  model: Joi.string().optional().allow(''),
  serialNumber: Joi.string().required(),
  condition: Joi.string().required().valid(...VALID_ASSET_CONDITIONS),
  specifications: Joi.string().optional().allow(''),
  purchaseDate: Joi.date().optional(),
  status: Joi.string()
    .optional()
    .valid(...VALID_ASSET_INVENTORY_CREATE_STATUS)
    .default('available')
    .messages({
      'any.only':
        'Status at create must be one of: available, under_repair, returned_to_vendor',
    }),
  notes: Joi.string().optional().allow('').max(2000),
}).options({ stripUnknown: true });

const listAssetInventorySchema = Joi.object({
  page: Joi.number().integer().positive().optional().default(1),
  limit: Joi.number().integer().positive().optional().default(10),
  search: Joi.string().trim().allow('').optional(),
  assetType: Joi.string().trim().allow('').optional(),
  status: Joi.string()
    .trim()
    .allow('')
    .optional()
    .custom((value, helpers) => {
      if (!value) return value;
      if (!VALID_ASSET_INVENTORY_STATUS.includes(value)) {
        return helpers.error('any.only');
      }
      return value;
    })
    .messages({
      'any.only': `Status filter must be one of: ${VALID_ASSET_INVENTORY_STATUS.join(', ')}`,
    }),
  departmentId: objectIdSchema.optional(),
}).options({ stripUnknown: true });


const updateAssignedAssetSchema = Joi.object({
  status: Joi.string()
    .required()
    .valid(...VALID_ASSETS_STATUS)
    .messages({
      'string.empty': 'Status is required',
      'any.required': 'Status is required',
      'any.only': `Status must be one of the following: ${VALID_ASSETS_STATUS.join(', ')}`,
    }),
  specifications: Joi.string().optional().allow(''),
  serialNumber: Joi.string().optional().allow(''),
}).options({ stripUnknown: true });


const getAllUsersSchema = Joi.object({
  page: Joi.number().integer().positive().optional().default(1),
  limit: Joi.number().integer().positive().optional().default(10),
  search: Joi.string().trim().allow('').optional(),
}).options({ stripUnknown: true });

const getAssignedAssetByUserIdSchema = Joi.object({
  userId: Joi.string().required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
}).options({ stripUnknown: true });


const acknowledgeAssetSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
  userId: Joi.string().required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
}).options({ stripUnknown: true });

const rejectAssetSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
  userId: Joi.string().required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
}).options({ stripUnknown: true });


const returnAssetSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
  userId: Joi.string().required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
})

const handleAssetRequestUpdateSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
  status: Joi.string()
    .required()
    .valid(...VALID_ASSET_REQUEST_STATUS)
    .messages({
      'string.empty': 'Status is required',
      'any.required': 'Status is required',
      'any.only': `Status must be one of the following: ${VALID_ASSET_REQUEST_STATUS.join(', ')}`,
    }),
  rejectionReason: Joi.when('status', {
    is: 'asset-request-rejected',
    then: Joi.string().trim().min(1).max(500).required().messages({
      'string.empty': 'Rejection reason is required when rejecting a request',
      'any.required': 'Rejection reason is required when rejecting a request',
      'string.min': 'Rejection reason cannot be empty',
      'string.max': 'Rejection reason cannot exceed 500 characters',
    }),
    otherwise: Joi.string().optional().allow('').max(500).messages({
      'string.max': 'Rejection reason cannot exceed 500 characters',
    })
  }),
}).options({ stripUnknown: true });

// For updating return request status on assigned assets
const handleReturnRequestUpdateSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'string.empty': 'ID is required',
    'any.required': 'ID is required',
  }),
  status: Joi.string()
    .required()
    .valid('return_requested', 'return_approved', 'return_rejected', 'returned')
    .messages({
      'string.empty': 'Status is required',
      'any.required': 'Status is required',
      'any.only': 'Status must be one of the following: return_requested, return_approved, return_rejected, returned',
    }),
}).options({ stripUnknown: true });

const createAssetRequestSchema = Joi.object({
  assetType: Joi.string().required().messages({
    'string.empty': 'Asset Type is required',
    'any.required': 'Asset Type is required',
  }),
  specifications: Joi.string().required().messages({
    'string.empty': 'Specifications are required',
    'any.required': 'Specifications are required',
  }),
  neededBy: Joi.date().required().messages({
    'date.base': 'Needed By date is required',
    'any.required': 'Needed By date is required',
  }),
  description: Joi.string().optional().allow('').max(500).messages({
    'string.max': 'Description cannot exceed 500 characters',
  }),
  
  sendMail: Joi.boolean().optional(),
}).options({ stripUnknown: true });

module.exports = {
  assetAssignmentSchema,
  updateAssignedAssetSchema,
  getAllUsersSchema,
  getAssignedAssetByUserIdSchema,
  acknowledgeAssetSchema,
  rejectAssetSchema,
  returnAssetSchema,
  handleAssetRequestUpdateSchema,
  handleReturnRequestUpdateSchema,
  createAssetRequestSchema,
  createAssetInventorySchema,
  listAssetInventorySchema,
};
