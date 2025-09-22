const Joi = require('joi');

const createPersonalEventSchema = Joi.object({
  title: Joi.string().required().trim().min(1).max(100).messages({
    'string.empty': 'Event title is required',
    'string.min': 'Event title must be at least 1 character long',
    'string.max': 'Event title must not exceed 100 characters',
  }),
  description: Joi.string().trim().max(500).allow('').messages({
    'string.max': 'Event description must not exceed 500 characters',
  }),
  date: Joi.date().required().messages({
    'date.base': 'Valid date is required',
    'any.required': 'Event date is required',
  }),
  eventType: Joi.string().valid('appointment', 'personal', 'friends', 'other').default('personal').messages({
    'any.only': 'Event type must be one of: appointment, personal, friends, other',
  }),
  color: Joi.string().pattern(/^bg-\w+-\d+$/).default('bg-blue-300').messages({
    'string.pattern.base': 'Color must be a valid Tailwind CSS background color class',
  }),
  isAllDay: Joi.boolean().default(true),
  startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('').messages({
    'string.pattern.base': 'Start time must be in HH:MM format',
  }),
  endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('').messages({
    'string.pattern.base': 'End time must be in HH:MM format',
  }),
});

const updatePersonalEventSchema = Joi.object({
  title: Joi.string().trim().min(1).max(100).messages({
    'string.min': 'Event title must be at least 1 character long',
    'string.max': 'Event title must not exceed 100 characters',
  }),
  description: Joi.string().trim().max(500).allow('').messages({
    'string.max': 'Event description must not exceed 500 characters',
  }),
  date: Joi.date().messages({
    'date.base': 'Valid date is required',
  }),
  eventType: Joi.string().valid('appointment', 'personal', 'friends', 'other').messages({
    'any.only': 'Event type must be one of: appointment, personal, friends, other',
  }),
  color: Joi.string().pattern(/^bg-\w+-\d+$/).messages({
    'string.pattern.base': 'Color must be a valid Tailwind CSS background color class',
  }),
  isAllDay: Joi.boolean(),
  startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('').messages({
    'string.pattern.base': 'Start time must be in HH:MM format',
  }),
  endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).allow('').messages({
    'string.pattern.base': 'End time must be in HH:MM format',
  }),
});

const personalEventIdSchema = Joi.object({
  id: Joi.string().required().messages({
    'string.empty': 'Event ID is required',
    'any.required': 'Event ID is required',
  }),
});

module.exports = {
  createPersonalEventSchema,
  updatePersonalEventSchema,
  personalEventIdSchema,
};
