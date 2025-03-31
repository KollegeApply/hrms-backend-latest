// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { default: httpStatus } = require('http-status');
const ApiError = require('../utility/ApiError');
const logger = require('../config/logger');

/**
 * Middleware to authenticate user requests using JWT.
 * Verifies the token from the 'x-auth-token' header.
 * Attaches the decoded user payload (id, role) to `req.user`.
 */
const authenticateUser = (req, res, next) => {
  const token = req.header('x-auth-token'); // Standard practice: use 'Authorization': 'Bearer TOKEN'

  if (!token) {
    logger.warn('Authentication failed: No token provided');
    // Use next(error) for centralized error handling
    return next(
      new ApiError(httpStatus.UNAUTHORIZED, 'Access denied. No token provided.')
    );
  }

  try {
    // Verify the token using the secret key
    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    // Attach user information (payload) to the request object
    req.user = decoded; // Decoded payload usually contains { id: '...', role: '...' }
    logger.info(`User authenticated: ${req.user.id}, Role: ${req.user.role}`);
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    logger.error('Authentication failed: Invalid token', error);
    if (error instanceof jwt.TokenExpiredError) {
      return next(
        new ApiError(
          httpStatus.UNAUTHORIZED,
          'Token expired. Please log in again.'
        )
      );
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return next(
        new ApiError(
          httpStatus.UNAUTHORIZED,
          'Invalid token. Authentication failed.'
        )
      );
    }
    // Generic error for other verification issues
    return next(
      new ApiError(httpStatus.BAD_REQUEST, 'Token verification failed.')
    );
  }
};

/**
 * Middleware to authorize users based on required roles.
 * Must be used AFTER authenticateUser middleware.
 * @param {string[]} requiredRoles - An array of roles allowed to access the route.
 */
const authorizeRole = (requiredRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      logger.error(
        'Authorization failed: User data not found in request. Ensure authenticateUser runs first.'
      );
      return next(
        new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Authorization error.')
      );
    }

    const userRole = req.user.role;
    if (!requiredRoles.includes(userRole)) {
      logger.warn(
        `Authorization denied for user ${req.user.id} (role: ${userRole}). Required roles: ${requiredRoles.join(', ')}`
      );
      return next(
        new ApiError(
          httpStatus.FORBIDDEN,
          'Access denied. You do not have permission to perform this action.'
        )
      );
    }

    logger.info(
      `User ${req.user.id} (role: ${userRole}) authorized for roles: ${requiredRoles.join(', ')}`
    );
    next(); // User has the required role, proceed
  };
};

module.exports = {
  authenticateUser,
  authorizeRole,
};
