const Joi = require('joi');

const objectIdSchema = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });

const createBookingSchema = Joi.object({
  roomId: objectIdSchema.required().messages({ 'any.required': 'roomId is required.' }),
  title: Joi.string().trim().min(1).max(200).required().messages({ 'any.required': 'title is required.' }),
  startTime: Joi.date().required().messages({ 'any.required': 'startTime is required.' }),
  endTime: Joi.date().required().messages({ 'any.required': 'endTime is required.' }),
  attendees: Joi.array().items(objectIdSchema).default([]),
}).custom((value, helpers) => {
  if (new Date(value.endTime) <= new Date(value.startTime)) {
    return helpers.error('any.invalid', { message: 'endTime must be after startTime' });
  }
  return value;
}, 'Time range validation').options({ stripUnknown: true });

const idParamSchema = Joi.object({
  id: objectIdSchema.required().messages({ 'any.required': 'id is required.' }),
});

const getBookingsQuerySchema = Joi.object({
  roomId: objectIdSchema.optional(),
  date: Joi.date().optional(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  userType: Joi.string().valid('all', 'my').default('all').messages({
    'any.only': 'userType must be either "all" or "my"'
  }),
}).options({ stripUnknown: true });

module.exports = {
  createBookingSchema,
  idParamSchema,
  getBookingsQuerySchema,
};

// Update schema (optional fields)
const updateBookingSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional(),
  roomId: objectIdSchema.optional(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  attendees: Joi.array().items(objectIdSchema).optional(),
})
.custom((value, helpers) => {
  if (value.startTime && value.endTime) {
    if (new Date(value.endTime) <= new Date(value.startTime)) {
      return helpers.error('any.invalid', { message: 'endTime must be after startTime' });
    }
  }
  return value;
}, 'Time range validation')
.options({ stripUnknown: true });

module.exports.updateBookingSchema = updateBookingSchema;

// Submit MOM schema
const submitMomSchema = Joi.object({
  contentHtml: Joi.string().trim().min(1).required(),
}).options({ stripUnknown: true });

module.exports.submitMomSchema = submitMomSchema;


