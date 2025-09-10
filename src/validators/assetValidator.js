// file: validators/assetValidator.js
const Joi = require('joi');
const { VALID_ASSETS_STATUS, VALID_LAPTOP_TYPES, VALID_ASSET_REQUEST_STATUS } = require('../utility/constants');


const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const assetAssignmentSchema = Joi.object({
  assetType: Joi.string().required().messages({
    'string.empty': 'Asset Type is required',
    'any.required': 'Asset Type is required',
  }),
  // assetId: Joi.string().required().messages({
  //   'string.empty': 'Asset ID is required',
  //   'any.required': 'Asset ID is required',
  // }),
  assetName: Joi.string().required().messages({
    'string.empty': 'Asset Name is required',
    'any.required': 'Asset Name is required',
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
  status: Joi.string()
    .required()
    .valid(...VALID_ASSETS_STATUS)
    .messages({
      'any.only': `Status must be one of the following: ${VALID_ASSETS_STATUS.join(', ')}`,
    }),
  sendMail: Joi.boolean().optional(),
  laptopType: Joi.string().optional().allow('').valid(...VALID_LAPTOP_TYPES).messages({
    'any.only': `Laptop Type must be one of: ${VALID_LAPTOP_TYPES.join(', ')}`,
  }),
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
  createAssetRequestSchema,
};
