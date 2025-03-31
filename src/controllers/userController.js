// src/controllers/userController.js
const { default: httpStatus } = require('http-status');
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');
const userValidator = require('../validators/userValidator');
const Helper = require('../utility/helper');
const ApiError = require('../utility/ApiError'); // Ensure this utility exists
const catchAsync = require('../utility/catchAsync'); // Ensure this utility exists
const logger = require('../config/logger');

/**
 * Utility to generate JWT token.
 * @param {object} user - User object (should have id and role).
 * @returns {string} - JWT token.
 */
const generateToken = (user) => {
  const payload = { id: user.id, role: user.role };
  // Use a reasonable expiration time (e.g., '1d', '7d', '1h')
  return jwt.sign(payload, process.env.SECRET_KEY, { expiresIn: '1d' });
};

// Wrap controller methods with catchAsync for cleaner error handling
const createUser = catchAsync(async (req, res) => {
  // 1. Validate request body
  const validatedData = await userValidator.createUserSchema.validateAsync(
    req.body
  );

  // 2. Call service to create user
  const user = await userService.createUser(validatedData);

  // 3. Optionally send welcome email (consider security implications of sending password)
  const sendMail = req.query.sendMail === 'true';
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    logger.info(`Sending welcome email to ${user.email}`);
    Helper.sendEmail({
      receiverEmails: [user.email],
      subject: 'Welcome to the HRMS Portal!',
      message: Helper.getWelcomeEmail(
        user.firstName,
        user.email,
        user.role,
        validatedData.password, // !! SECURITY RISK: Avoid sending plain password
        process.env.HRMS_FRONTEND_URL
      ),
    }).catch((err) =>
      logger.error(`Failed to send welcome email to ${user.email}:`, err)
    ); // Log email sending errors but don't fail the request
  }

  // 4. Send response
  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'User created successfully.',
    data: user, // User object already cleaned by toJSON
  });
});

const getAllUsers = catchAsync(async (req, res) => {
  // 1. Validate query parameters
  const validatedQuery = await userValidator.getAllUsersSchema.validateAsync(
    req.query
  );

  // 2. Call service to get users
  const result = await userService.getAllUsers(validatedQuery); // Service handles pagination logic

  // 3. Send response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Users retrieved successfully.',
    ...result, // Spread the result which contains data and pagination info
  });
});

const getUserById = catchAsync(async (req, res) => {
  // 1. Validate ID parameter (using Helper for basic check, Joi for strictness)
  await userValidator.mongoIdSchema.validateAsync(req.params); // Validate ID format
  const userId = req.params.id;

  if (!Helper.isValidMongoId(userId)) {
    // Redundant if Joi validation passes, but good defense
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }

  // 2. Call service to get user
  const user = await userService.getUserById(userId);

  // 3. Handle not found
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
  }

  // 4. Send response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'User retrieved successfully.',
    data: user, // User object already cleaned by toJSON
  });
});

const updateUser = catchAsync(async (req, res) => {
  // 1. Validate ID parameter
  await userValidator.mongoIdSchema.validateAsync(req.params);
  const userId = req.params.id;
  if (!Helper.isValidMongoId(userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }

  // 2. Validate request body (ensure at least one field is present)
  const validatedData = await userValidator.updateUserSchema.validateAsync(
    req.body
  );
  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No valid fields provided for update.'
    );
  }

  // 3. Call service to update user
  const updatedUser = await userService.updateUser(userId, validatedData);

  // 4. Handle not found
  if (!updatedUser) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'User not found or update failed.'
    );
  }

  // 5. Send response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'User updated successfully.',
    data: updatedUser, // User object already cleaned by toJSON
  });
});

const deleteUser = catchAsync(async (req, res) => {
  // 1. Validate ID parameter
  await userValidator.mongoIdSchema.validateAsync(req.params);
  const userId = req.params.id;
  if (!Helper.isValidMongoId(userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }

  // 2. Call service to delete user (soft delete)
  const success = await userService.deleteUser(userId);

  // 3. Handle not found
  if (!success) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
  }

  // 4. Send response (HTTP 204 No Content is also suitable for successful deletions)
  res.status(httpStatus.OK).json({
    status: true,
    message: 'User deleted successfully.',
  });
  // Or: res.status(httpStatus.NO_CONTENT).send();
});

const login = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email, password } = await userValidator.loginSchema.validateAsync(
    req.body
  );

  // 2. Call service to authenticate user
  const user = await userService.authenticateUser(email, password);

  // 3. Handle authentication failure
  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password.');
  }

  // 4. Generate JWT token
  const token = generateToken(user);

  // 5. Send response with user data and token
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Login successful.',
    data: user, // User object already cleaned by toJSON
    token: token,
  });
});

const changePassword = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { oldPassword, newPassword } =
    await userValidator.changePasswordSchema.validateAsync(req.body);

  // 2. Get user ID from authenticated user
  const userId = req.user.id; // Assumes authenticateUser middleware ran successfully

  // 3. Call service to change password
  await userService.changePassword(userId, oldPassword, newPassword);

  // 4. Send success response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Password changed successfully.',
  });
});

const forgotPassword = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email } = await userValidator.forgotPasswordSchema.validateAsync(
    req.body
  );

  // 2. Call service to request reset
  await userService.requestPasswordReset(email);

  // 3. Send generic success response (for security)
  res.status(httpStatus.OK).json({
    status: true,
    message:
      'If an account with that email exists, a password reset link has been sent.',
  });
});

const verifyOtp = catchAsync(async (req, res) => {
  // 1. Validate request body for email, otp, newPassword
  const { email, otp, newPassword } =
    await userValidator.verifyOtpSchema.validateAsync(req.body);

  // 2. Call service to verify OTP and reset password
  await userService.verifyOtpAndResetPassword(email, otp, newPassword);

  // 3. Send success response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Password has been reset successfully.',
  });
});

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  login,
  changePassword,
  forgotPassword,
  verifyOtp,
};

// --- Utility: catchAsync (Place in src/utility/catchAsync.js) ---
/*
// src/utility/catchAsync.js
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

module.exports = catchAsync;
*/
