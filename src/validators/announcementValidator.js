const Joi = require('joi');

const createAnnouncementSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required().messages({
    'string.empty': 'Title is required',
    'string.min': 'Title must be at least 1 character long',
    'string.max': 'Title cannot exceed 200 characters',
    'any.required': 'Title is required'
  }),
  content: Joi.string().trim().min(1).max(1000).required().messages({
    'string.empty': 'Content is required',
    'string.min': 'Content must be at least 1 character long',
    'string.max': 'Content cannot exceed 1000 characters',
    'any.required': 'Content is required'
  }),
  date: Joi.date().required().messages({
    'date.base': 'Date must be a valid date',
    'any.required': 'Date is required'
  }),
  time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required().messages({
    'string.pattern.base': 'Time must be in HH:MM format',
    'any.required': 'Time is required'
  }),
  category: Joi.string().valid('general', 'department').default('general').messages({
    'any.only': 'Category must be either general or department'
  }),
  departmentId: Joi.when('category', {
    is: 'department',
    then: Joi.string().required().messages({
      'any.required': 'Department ID is required when category is department'
    }),
    otherwise: Joi.string().allow(null, '')
  }),
  expireInHours: Joi.number().integer().min(1).max(168).default(24).messages({
    'number.base': 'Expire in hours must be a number',
    'number.integer': 'Expire in hours must be an integer',
    'number.min': 'Expire in hours must be at least 1',
    'number.max': 'Expire in hours cannot exceed 168 (1 week)'
  })
});

const updateAnnouncementSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).messages({
    'string.empty': 'Title cannot be empty',
    'string.min': 'Title must be at least 1 character long',
    'string.max': 'Title cannot exceed 200 characters'
  }),
  content: Joi.string().trim().min(1).max(1000).messages({
    'string.empty': 'Content cannot be empty',
    'string.min': 'Content must be at least 1 character long',
    'string.max': 'Content cannot exceed 1000 characters'
  }),
  date: Joi.date().messages({
    'date.base': 'Date must be a valid date'
  }),
  time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).messages({
    'string.pattern.base': 'Time must be in HH:MM format'
  }),
  category: Joi.string().valid('general', 'department').messages({
    'any.only': 'Category must be either general or department'
  }),
  departmentId: Joi.when('category', {
    is: 'department',
    then: Joi.string().required().messages({
      'any.required': 'Department ID is required when category is department'
    }),
    otherwise: Joi.string().allow(null, '')
  }),
  expireInHours: Joi.number().integer().min(1).max(168).messages({
    'number.base': 'Expire in hours must be a number',
    'number.integer': 'Expire in hours must be an integer',
    'number.min': 'Expire in hours must be at least 1',
    'number.max': 'Expire in hours cannot exceed 168 (1 week)'
  })
});

const getAnnouncementsSchema = Joi.object({
  category: Joi.string().valid('general', 'department').optional(),
  departmentId: Joi.string().allow(''),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('createdAt', 'date', 'title').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});

const announcementIdSchema = Joi.object({
  id: Joi.string().required().messages({
    'string.empty': 'Announcement ID is required',
    'any.required': 'Announcement ID is required'
  })
});

module.exports = {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  getAnnouncementsSchema,
  announcementIdSchema
};
