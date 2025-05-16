// file: validators/assetValidator.js
const Joi = require('joi');
const { VALID_ASSETS_STATUS } = require('../utility/constants');


const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const assetAssignmentSchema = Joi.object({
  assetId: Joi.string().required().messages({
    'string.empty': 'Asset ID is required',
    'any.required': 'Asset ID is required',
  }),
  assetName: Joi.string().required().messages({
    'string.empty': 'Asset Name is required',
    'any.required': 'Asset Name is required',
  }),
  assignee: Joi.string().required().messages({
    'string.empty': 'Assignee (Employee ID) is required',
    'any.required': 'Assignee (Employee ID)  is required',
  }),
  serialNo: Joi.string().optional().allow(''),
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

module.exports = {
  assetAssignmentSchema,
  updateAssignedAssetSchema,
  getAllUsersSchema,
  getAssignedAssetByUserIdSchema,
  acknowledgeAssetSchema,
  rejectAssetSchema,
};
