const Joi = require('joi');


const objectId = Joi.string()
  .custom((value, helpers) => {
    if (!/^[a-fA-F0-9]{24}$/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'ObjectId Validation')
  .message({ 'any.invalid': 'Invalid MongoDB ObjectId' });


const createTicketSchema = Joi.object({
  ticketType: Joi.string()
    .valid("Payroll and Salary query","HR & Grievance query","Expenses & Reimbursements","Admin & IT","Backdated attendance","Miscellaneous")
    .required(),

  subject: Joi.string()
    .min(3)
    .max(100)
    .required(),

  issue: Joi.string()
    .min(10)
    .required(),

  createdBy: objectId.required().messages({
    'any.required': 'createdById is required.'
  }),
});



const updateTicketSchema = Joi.object({
  status: Joi.string().valid('pending', 'in_progress', 'resolved','rejected'),
  actionReason: Joi.string().allow('', null),
  // Accept legacy/alternative client field and rename it to actionReason
  resolutionComment: Joi.string().allow('', null),
})
  .rename('resolutionComment', 'actionReason', { ignoreUndefined: true, override: true })
  .options({ stripUnknown: true });

module.exports = {
  createTicketSchema,
  updateTicketSchema,
};
