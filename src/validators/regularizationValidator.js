const Joi = require('joi');

const createRegularizationSchema = Joi.object({
  date: Joi.date().required().messages({
    'date.base': 'Date must be a valid date',
    'any.required': 'Date is required'
  }),
  correctedCheckIn: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required().messages({
    'string.pattern.base': 'Check-in time must be in HH:MM format (24-hour)',
    'any.required': 'Check-in time is required'
  }),
  correctedCheckOut: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required().messages({
    'string.pattern.base': 'Check-out time must be in HH:MM format (24-hour)',
    'any.required': 'Check-out time is required'
  }),
  reason: Joi.string().min(10).max(500).required().messages({
    'string.min': 'Reason must be at least 10 characters long',
    'string.max': 'Reason cannot exceed 500 characters',
    'any.required': 'Reason is required'
  }),
  type: Joi.string().valid('standard', 'emergency').default('standard').messages({
    'any.only': 'Type must be either standard or emergency'
  }),
  evidence: Joi.optional() // Evidence comes from file upload, not body
}).custom((value, helpers) => {
  // Custom validation for check-out time being after check-in time
  const [checkInHour, checkInMin] = value.correctedCheckIn.split(':').map(Number);
  const [checkOutHour, checkOutMin] = value.correctedCheckOut.split(':').map(Number);
  
  const checkInMinutes = checkInHour * 60 + checkInMin;
  const checkOutMinutes = checkOutHour * 60 + checkOutMin;
  
  if (checkOutMinutes <= checkInMinutes) {
    return helpers.error('any.invalid', { message: 'Check-out time must be after check-in time' });
  }
  
  return value;
});

const approveRegularizationSchema = Joi.object({
  comment: Joi.string().max(200).allow('', null).optional().messages({
    'string.max': 'Comment cannot exceed 200 characters'
  })
});

const rejectRegularizationSchema = Joi.object({
  reason: Joi.string().min(10).max(500).required().messages({
    'string.min': 'Rejection reason must be at least 10 characters long',
    'string.max': 'Rejection reason cannot exceed 500 characters',
    'any.required': 'Rejection reason is required'
  })
});

const validateCreateRegularization = (req, res, next) => {
  // For emergency type, check if file is uploaded
  if (req.body.type === 'emergency' && !req.file) {
    return res.status(400).json({
      message: 'Evidence is required for emergency regularization'
    });
  }

  // Remove evidence from body validation since it comes from file upload
  const bodyToValidate = { ...req.body };
  delete bodyToValidate.evidence;

  const { error, value } = createRegularizationSchema.validate(bodyToValidate);
  
  if (error) {
    return res.status(400).json({
      message: error.details[0].message
    });
  }
  
  req.validatedData = value;
  next();
};

const validateApproveRegularization = (req, res, next) => {
  const { error, value } = approveRegularizationSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      message: error.details[0].message
    });
  }
  
  req.validatedData = value;
  next();
};

const validateRejectRegularization = (req, res, next) => {
  const { error, value } = rejectRegularizationSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      message: error.details[0].message
    });
  }
  
  req.validatedData = value;
  next();
};

module.exports = {
  validateCreateRegularization,
  validateApproveRegularization,
  validateRejectRegularization
};
