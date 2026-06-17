const Joi = require('joi');

const profileChangeRequestListSchema = Joi.object({
  status: Joi.string().trim().optional(),
  department: Joi.string().trim().optional(),
  search: Joi.string().trim().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
});

const profileChangeDecisionSchema = Joi.object({
  note: Joi.string().trim().max(1000).allow('', null).default(''),
});

module.exports = {
  profileChangeRequestListSchema,
  profileChangeDecisionSchema,
};
