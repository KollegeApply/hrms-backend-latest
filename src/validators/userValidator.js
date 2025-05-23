const Joi = require('joi');
const {
  VALID_USER_ROLES,
  VALID_EMPLOYEE_STATUS,
} = require('../utility/constants');

// Base schema for common address fields (optional)
const addressSchema = Joi.object({
  street: Joi.string().trim().optional().allow('', null),
  city: Joi.string().trim().optional().allow('', null),
  state: Joi.string().trim().optional().allow('', null),
  zipCode: Joi.string().trim().optional().allow('', null),
  country: Joi.string().trim().optional().allow('', null),
});

const leavesSchema = Joi.object({
  annualLeave: Joi.object({
    // For On-Roll Employees
    total: Joi.number().optional(), // Total annual leave for the year
    available: Joi.number().optional(), // Available annual leave
    quarters: Joi.array()
      .items(
        Joi.object({
          quarter: Joi.number().valid(1, 2, 3, 4).required(), // Quarter number (1-4)
          available: Joi.number().optional(), // Available leave at the start of the quarter
          used: Joi.number().optional(), // Leave used in the quarter
        })
      )
      .optional(),
  }).optional(),
  casualSickLeave: Joi.object({
    // For On-Roll Employees
    total: Joi.number().optional(),
    available: Joi.number().optional(),
    quarters: Joi.array()
      .items(
        Joi.object({
          quarter: Joi.number().valid(1, 2, 3, 4).required(),
          available: Joi.number().optional(),
          used: Joi.number().optional(),
        })
      )
      .optional(),
  }).optional(),
  bereavementLeave: Joi.object({
    // No quarterly tracking, just total
    total: Joi.number().optional(),
    available: Joi.number().optional(),
  }).optional(),
  marriageLeave: Joi.object({
    total: Joi.number().optional(),
    available: Joi.number().optional(),
  }).optional(),
  birthdayLeave: Joi.object({
    total: Joi.number().optional(),
    available: Joi.number().optional(),
  }).optional(),
  carryForwardLeave: Joi.object({
    total: Joi.number().optional(),
    used: Joi.number().optional(),
  }).optional(),
  perMonth: Joi.number().optional(),
  total: Joi.number().optional(),
});

// Schema for validating MongoDB ObjectIds in parameters
const mongoIdSchema = Joi.object({
  id: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/) // Basic ObjectId format check
    .required()
    .messages({
      'string.pattern.base': 'Invalid ID format',
      'string.empty': 'ID is required',
      'any.required': 'ID is required',
    }),
});

// Schema for creating a new user
const createUserSchema = Joi.object({
  firstName: Joi.string().trim().min(1).required().messages({
    'string.base': 'First name must be a string',
    'string.empty': 'First name is required',
    'string.min': 'First name must have at least 1 character',
    'any.required': 'First name is required',
  }),
  lastName: Joi.string().trim().min(1).required().messages({
    'string.empty': 'Last name is required',
    'any.required': 'Last name is required',
  }),
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).required().messages({
    // Increased min length for better security
    'string.min': 'Password must be at least 8 characters long',
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
  employeeId: Joi.string().trim().allow('', null).optional(),
  jobTitle: Joi.string().trim().optional().allow('', null),
  department: Joi.string().trim().allow('', null).optional(),
  hireDate: Joi.date().iso().optional().allow(null), // Expect ISO format (YYYY-MM-DD)
  phoneNumber: Joi.string().trim().optional().allow('', null),
  address: addressSchema.optional(),
  leaves: leavesSchema.optional(),
  teamLeadId: Joi.string()
    .trim()
    .allow('', null)
    // .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'any.required': 'ID is required',
    })
    .optional(),
  subTeamLeadId: Joi.string()
    .trim()
    .allow('', null)
    // .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'any.required': 'ID is required',
    })
    .optional(),
  hrPocId: Joi.string()
    .trim()
    .allow('', null)
    // .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'any.required': 'ID is required',
    })
    .optional(),

  role: Joi.string()
    .valid(...VALID_USER_ROLES)
    .optional()
    .messages({
      // Default is set in model
      'any.only': `Role must be one of [${VALID_USER_ROLES.join(', ')}]`,
    }),
  status: Joi.string()
    .valid(...VALID_EMPLOYEE_STATUS)
    .optional()
    .messages({
      // Default is set in model
      'any.only': `Status must be one of [${VALID_EMPLOYEE_STATUS.join(', ')}]`,
    }),
  workType: Joi.string().trim().min(1).required().messages({
    'string.empty': 'Work type is required',
    'any.required': 'Work type is required',
  }),
}).options({ stripUnknown: true }); // Remove fields not defined in the schema

// Schema for updating an existing user
const updateUserSchema = Joi.object({
  firstName: Joi.string().trim().min(1).optional(),
  lastName: Joi.string().trim().min(1).optional(),
  email: Joi.string().trim().email().optional().messages({
    'string.email': 'Please provide a valid email address',
  }),
  // Password update should likely be a separate endpoint/process for security
  // password: Joi.string().min(8).optional(),
  employeeId: Joi.string().trim().optional().allow('', null),
  jobTitle: Joi.string().trim().optional().allow('', null),
  department: Joi.string().trim().optional().allow('', null),
  hireDate: Joi.date().iso().optional().allow(null),
  phoneNumber: Joi.string().trim().optional().allow('', null),
  teamLeadId: Joi.string().hex(),
  subTeamLeadId: Joi.string().hex().allow(null, ''),
  hrPocId: Joi.string().hex().allow(null, ''),

  address: addressSchema.optional(),
  role: Joi.string()
    .valid(...VALID_USER_ROLES)
    .optional()
    .messages({
      'any.only': `Role must be one of [${VALID_USER_ROLES.join(', ')}]`,
    }),
  status: Joi.string()
    .valid(...VALID_EMPLOYEE_STATUS)
    .optional()
    .messages({
      'any.only': `Status must be one of [${VALID_EMPLOYEE_STATUS.join(', ')}]`,
    }),
  workType: Joi.string().trim().optional().allow('', null).messages({
    'string.empty': 'Work type cannot be empty',
  }),
})
  .min(1)
  .options({ stripUnknown: true }); // Require at least one field to update

// Schema for user login
const loginSchema = Joi.object({
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
}).options({ stripUnknown: true });

// Schema for validating query parameters for fetching users
const getAllUsersSchema = Joi.object({
  page: Joi.number().integer().positive().optional().default(1),
  limit: Joi.number().integer().positive().optional().default(10),
  search: Joi.string().trim().allow('').optional(),
  role: Joi.string()
    .valid(...VALID_USER_ROLES)
    .optional(),
  status: Joi.string()
    .valid(...VALID_EMPLOYEE_STATUS)
    .optional(),
  department: Joi.string().trim().allow('').optional(),
  sortBy: Joi.string().trim().optional().default('createdAt'), // Field to sort by
  sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'), // Sort direction
  isPaginated: Joi.boolean().optional().default(true), // Default to paginated results
}).options({ stripUnknown: true });

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    'string.empty': 'Current password is required',
    'any.required': 'Current password is required',
  }),
  newPassword: Joi.string().min(8).required().messages({
    'string.min': 'New password must be at least 8 characters long',
    'string.empty': 'New password is required',
    'any.required': 'New password is required',
  }),
  // Optional: Add complexity rules (e.g., regex for uppercase, number, symbol)
  // newPassword: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])')).required().messages({ ... }),
}).options({ stripUnknown: true });

// Schema for requesting a password reset link
const forgotPasswordSchema = Joi.object({
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
}).options({ stripUnknown: true });

const verifyOtpSchema = Joi.object({
  email: Joi.string().trim().email().required().messages({
    // Need email to find user
    'string.email': 'Please provide a valid email address',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  otp: Joi.string()
    .trim()
    .length(6) // Assuming 6-digit OTP
    .pattern(/^[0-9]+$/) // Ensure it's numeric
    .required()
    .messages({
      'string.length': 'OTP must be 6 digits long',
      'string.pattern.base': 'OTP must contain only digits',
      'string.empty': 'OTP is required',
      'any.required': 'OTP is required',
    }),
  newPassword: Joi.string().min(8).required().messages({
    'string.min': 'New password must be at least 8 characters long',
    'string.empty': 'New password is required',
    'any.required': 'New password is required',
  }),
}).options({ stripUnknown: true });

const bulkCreateUserRowSchema = Joi.object({
  firstName: Joi.string().trim().min(1).required().messages({
    'string.empty': 'FirstName is required',
    'any.required': 'FirstName is required',
  }),
  lastName: Joi.string().trim().min(1).required().messages({
    'string.empty': 'LastName is required',
    'any.required': 'LastName is required',
  }),
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Invalid Email format',
    'string.empty': 'Email is required',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).required().messages({
    'string.min': 'Password must be at least 8 characters long',
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
  jobTitle: Joi.string().trim().optional().allow('', null),
  department: Joi.string()
    .trim()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .allow('', null)
    .messages({
      'string.pattern.base': 'Invalid Department ObjectId',
    }),
  hireDate: Joi.date().optional().allow('', null).iso().messages({
    // Expects YYYY-MM-DD
    'date.format': 'HireDate must be in YYYY-MM-DD format',
  }),
  phoneNumber: Joi.string().trim().optional().allow('', null),
  teamLeadId: Joi.string().trim().optional().allow('', null).messages({
    'string.pattern.base': 'Invalid TeamLeadID ObjectId',
  }),
  subTeamLeadId: Joi.string().trim().optional().allow('', null).messages({
    'string.pattern.base': 'Invalid SubTeamLeadID ObjectId',
  }),
  role: Joi.string()
    .trim()
    .valid(...VALID_USER_ROLES)
    .required()
    .messages({
      'any.only': `Role must be one of [${VALID_USER_ROLES.join(', ')}]`,
      'string.empty': 'Role is required',
      'any.required': 'Role is required',
    }),
  status: Joi.string()
    .trim()
    .valid(...VALID_EMPLOYEE_STATUS)
    .required()
    .messages({
      'any.only': `Status must be one of [${VALID_EMPLOYEE_STATUS.join(', ')}]`,
      'string.empty': 'Status is required',
      'any.required': 'Status is required',
    }),
}).options({ stripUnknown: true });


const getUserHistorySchema = Joi.object({
  userId: Joi.string().trim().required().messages({
    'string.empty': 'UserId is required',
    'any.required': 'UserId is required',
  }),
}).options({ stripUnknown: true });

module.exports = {
  createUserSchema,
  updateUserSchema,
  leavesSchema,
  loginSchema,
  mongoIdSchema,
  getAllUsersSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  bulkCreateUserRowSchema,
  getUserHistorySchema
};