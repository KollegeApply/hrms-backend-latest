// src/controllers/userController.js
const { default: httpStatus } = require('http-status');
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');
const userValidator = require('../validators/userValidator');
const Helper = require('../utility/helper');
const ApiError = require('../utility/ApiError'); // Ensure this utility exists
const catchAsync = require('../utility/catchAsync'); // Ensure this utility exists
const logger = require('../config/logger');
const { CSV_TYPES } = require('../utility/constants');
const User = require('../models/userModel');

/**
 * Utility to generate JWT token.
 * @param {object} user - User object (should have id and role).
 * @returns {string} - JWT token.
 */
const generateToken = (user) => {
  const payload = { id: user?.id, role: user?.role };
  // Use a reasonable expiration time (e.g., '1d', '7d', '1h')
  return jwt.sign(payload, process?.env?.SECRET_KEY, { expiresIn: '1d' });
};

// Wrap controller methods with catchAsync for cleaner error handling
const createUser = catchAsync(async (req, res) => {
  // 1. Validate request body
  const validatedData = await userValidator?.createUserSchema?.validateAsync(
    req?.body
  );

  const user = await userService.createUser(validatedData);

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending welcome email to ${user.email}`);
    Helper.sendEmail({
      receiverEmails: [user?.email],
      subject: `Welcome to ${process?.env?.TEAM} – Let’s Get You Started!`,
      message: Helper.getWelcomeEmail(
        user?.firstName,
        user?.email,
        validatedData?.password, // !! SECURITY RISK: Avoid sending plain password
        process?.env?.HRMS_FRONTEND_URL
      ),
    }).catch((err) =>
      logger.error(`Failed to send welcome email to ${user?.email}:`, err)
    ); // Log email sending errors but don't fail the request
  }

  // 4. Send response
  res.status(httpStatus?.CREATED).json({
    status: true,
    message: 'User created successfully.',
    data: user, // User object already cleaned by toJSON
  });
});

const getAllUsers = catchAsync(async (req, res) => {
  // 1. Validate query parameters
  const validatedQuery = await userValidator?.getAllUsersSchema?.validateAsync(
    req?.query
  );

  // 2. Call service to get users
  const result = await userService?.getAllUsers(validatedQuery); // Service handles pagination logic

  // 3. Send response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Users retrieved successfully.',
    ...result, // Spread the result which contains data and pagination info
  });
});

const getUserById = catchAsync(async (req, res) => {
  // 1. Validate ID parameter (using Helper for basic check, Joi for strictness)
  await userValidator?.mongoIdSchema?.validateAsync(req.params); // Validate ID format
  const userId = req?.params?.id;

  if (!Helper.isValidMongoId(userId)) {
    // Redundant if Joi validation passes, but good defense
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }

  // 2. Call service to get user
  const user = await userService?.getUserById(userId);

  // 3. Handle not found
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
  }

  // 4. Send response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'User retrieved successfully.',
    data: user, // User object already cleaned by toJSON
  });
});

const updateUser = catchAsync(async (req, res) => {
  await userValidator?.mongoIdSchema?.validateAsync(req.params);
  const userId = req?.params?.id;
  if (!Helper.isValidMongoId(userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }
  const oldUser = await User.findById(userId);
  const validatedData = await userValidator?.updateUserSchema?.validateAsync(
    req?.body
  );
  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No valid fields provided for update.'
    );
  }

  const updatedUser = await userService?.updateUser(userId, validatedData);

  if (!updatedUser) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'User not found or update failed.'
    );
  }
  // const oldUser = await User.findById(oldUserId);
  console.log('oldUser is: ', oldUser);
  console.log('updatedUser is: ', updatedUser);
  if (oldUser?.status === 'probation' && updatedUser?.status === 'onroll') {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Conversion from probation to onroll ${updatedUser?.email}`);
      Helper.sendEmail({
        receiverEmails: [updatedUser?.email],
        subject: `You’ve Earned Full-Time Status! Congratulations !!`,
        message: Helper.fullTimeConversion(
          updatedUser?.firstName,
          tomorrow.toISOString(),
          updatedUser?.jobTitle
        ),
      }).catch((err) =>
        logger.error(
          `Failed to send conversion from probation to full-time email ${updatedUser?.email}:`,
          err
        )
      );
    }
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'User updated successfully.',
    data: updatedUser, // User object already cleaned by toJSON
  });
});

const deleteUser = catchAsync(async (req, res) => {
  // 1. Validate ID parameter
  await userValidator?.mongoIdSchema?.validateAsync(req.params);
  const userId = req?.params?.id;
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
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'User deleted successfully.',
  });
  // Or: res.status(httpStatus.NO_CONTENT).send();
});

const login = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email, password } = await userValidator.loginSchema.validateAsync(
    req?.body
  );

  // 2. Call service to authenticate user
  const user = await userService?.authenticateUser(email, password);

  // 3. Handle authentication failure
  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password.');
  }

  // 4. Generate JWT token
  const token = generateToken(user);

  // 5. Send response with user data and token
  res?.status(httpStatus.OK).json({
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
  const userId = req?.user?.id; // Assumes authenticateUser middleware ran successfully

  // 3. Call service to change password
  await userService.changePassword(userId, oldPassword, newPassword);

  // 4. Send success response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Password changed successfully.',
  });
});

const forgotPassword = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email } = await userValidator.forgotPasswordSchema.validateAsync(
    req?.body
  );

  // 2. Call service to request reset
  await userService?.requestPasswordReset(email);

  // 3. Send generic success response (for security)
  res?.status(httpStatus.OK).json({
    status: true,
    message:
      'If an account with that email exists, a password reset link has been sent.',
  });
});

const verifyOtp = catchAsync(async (req, res) => {
  // 1. Validate request body for email, otp, newPassword
  const { email, newPassword, otp } =
    await userValidator.verifyOtpSchema.validateAsync(req.body);

  // 2. Call service to verify OTP and reset password
  await userService?.verifyOtpAndResetPassword(email, newPassword, otp);

  // 3. Send success response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Password has been reset successfully.',
  });
});

const bulkUpload = async (req, res) => {
  const activity = 'Bulk Upload Users |';
  try {
    const usersFile = req?.files?.[0];

    if (!usersFile) {
      console.log(`${activity} File is required.`);
      return res?.status(400).send({
        status: false,
        message: 'CSV file is required.',
        isErrorForUser: true,
      });
    }

    if (!CSV_TYPES.includes(usersFile?.mimetype)) {
      console.log(`${activity} Invalid file type: ${usersFile?.mimetype}`);
      return res?.status(400)?.send({
        status: false,
        message: 'Invalid file type. Please upload a valid CSV file.',
        isErrorForUser: true,
      });
    }

    const {
      status,
      code,
      data,
      message,
      isErrorForUser = false,
    } = await userService.bulkUpload(usersFile, activity);

    // Send response back
    return res?.status(code || 200).send({
      status,
      ...(message && { message }),
      ...(data && { data }), // 'data' will contain the invalid rows report
      isErrorForUser,
    });
  } catch (error) {
    console.error(`${activity} Error during bulk upload process:`, error);
    const statusCode = error?.statusCode || 500;
    const message =
      error?.message || 'An unexpected error occurred during bulk user upload.';

    const clientMessage =
      statusCode === 500 ? 'An internal server error occurred.' : message;

    return res.status(statusCode).send({
      status: false,
      message: clientMessage,
      isErrorForUser: statusCode !== 500,
    });
  }
};

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
  bulkUpload,
};

// --- Utility: catchAsync (Place in src/utility/catchAsync.js) ---
/*
// src/utility/catchAsync.js
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

module.exports = catchAsync;
*/
