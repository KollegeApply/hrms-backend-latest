const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const createDepartmentSchema = Joi.object({
  name: Joi.string().trim().min(1).required().messages({
    'string.base': 'Department name should be a string.',
    'string.empty': 'Department name should not be empty.',
    'any.required': 'Department name is required.',
  }),
  description: Joi.string().trim().optional().allow('', null).messages({
    'string.base': 'Department description must be string.',
  }),
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
}).options({ stripUnknown: true });

const updateDepartmentSchema = Joi.object({
  departmentId: objectIdSchema.required().messages({
    'any.required': 'departmentId is required.',
  }),
  name: Joi.string().trim().min(1).required().messages({
    'string.base': 'Department name should be a string.',
    'string.empty': 'Department name should not be empty.',
    'any.required': 'Department name is required.',
  }),
  description: Joi.string().trim().optional().allow('', null).messages({
    'string.base': 'Department description must be string.',
  }),
  edittorId: objectIdSchema.required().messages({
    'any.required': 'edittorId is required.',
  }),
});

const departmentIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'holidayId is required.',
  }),
});

module.exports = {
  createDepartmentSchema,
  departmentIdSchema,
  updateDepartmentSchema,
};
