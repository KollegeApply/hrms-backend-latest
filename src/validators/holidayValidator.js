const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const createHolidaySchema = Joi.object({
  name: Joi.string().trim().min(1).required().messages({
    'string.base': 'Holiday name should be a string.',
    'string.empty': 'Holiday name should not be empty.',
    'any.required': 'Holiday name is required.',
  }),
  date: Joi.date().iso().required().messages({
    'string.base': 'Holiday date must be a validate date.',
    'any.required': 'Holiday date is required.',
  }),
  userId: objectIdSchema.required().messages({
    'any.required': 'UserId is required.',
  }),
  holidayType: Joi.string().valid('Regular', 'Restricted').default('Regular').messages({
    'any.only': 'Holiday type must be either "Regular" or "Restricted".',
  }),
}).options({ stripUnknown: true });

const updateHolidaySchema = Joi.object({
  holidayId: objectIdSchema.required().messages({
    'any.required': 'holidayId is required.',
  }),
  name: Joi.string().trim().min(1).required().messages({
    'string.base': 'Holiday name should be a string.',
    'string.empty': 'Holiday name should not be empty.',
    'any.required': 'Holiday name is required.',
  }),
  date: Joi.date().iso().required().messages({
    'string.base': 'Holiday date must be a validate date.',
    'any.required': 'Holiday date is required.',
  }),
  holidayType: Joi.string().valid('Regular', 'Restricted').messages({
    'any.only': 'Holiday type must be either "Regular" or "Restricted".',
  }),
});

const holidayIdSchema = Joi.object({
  id: objectIdSchema.required().messages({
    'any.required': 'holidayId is required.',
  }),
});

module.exports = {
  createHolidaySchema,
  holidayIdSchema,
  updateHolidaySchema,
};
