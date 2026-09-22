// src/middleware/serviceAuthMiddleware.js
const crypto = require('crypto');
const { default: httpStatus } = require('http-status');
const ApiError = require('../utility/ApiError');
const logger = require('../config/logger');

/**
 * Validates a shared-secret header for trusted server-to-server calls --
 * as opposed to authenticateUser (JWT, a logged-in human). There is no
 * HRMS user on these requests, just another backend presenting a key it
 * was given out of band.
 *
 * Usage: verifyServiceSecret('SALES_CRM_API_KEY') as route middleware.
 * The env var named here must hold the same value the calling service
 * sends in the "x-api-secret" header.
 */
const verifyServiceSecret = (envVarName) => {
  return (req, res, next) => {
    const expected = process.env[envVarName];

    if (!expected) {
      logger.error(
        `${envVarName} is not configured -- refusing service-to-service request`
      );
      return next(
        new ApiError(
          httpStatus.INTERNAL_SERVER_ERROR,
          'Service integration is not configured.'
        )
      );
    }

    const provided = req.header('x-api-secret');
    if (!provided) {
      return next(
        new ApiError(httpStatus.UNAUTHORIZED, 'Missing x-api-secret header.')
      );
    }

    // Constant-time comparison -- avoids leaking the secret's length/prefix
    // through response-time differences.
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const isValid =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!isValid) {
      logger.warn('Rejected service-to-service request: invalid x-api-secret');
      return next(
        new ApiError(httpStatus.UNAUTHORIZED, 'Invalid x-api-secret.')
      );
    }

    next();
  };
};

module.exports = { verifyServiceSecret };
