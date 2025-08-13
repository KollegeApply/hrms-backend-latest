// --- Utility: Central Error Handler (Place in src/middleware/errorMiddleware.js) ---
const mongoose = require('mongoose');
const { default: httpStatus } = require('http-status');
const ApiError = require('../utility/ApiError');
const logger = require('../config/logger');

const errorConverter = (err, req, res, next) => {
  let error = err;
  if (!(error instanceof ApiError)) {
    const statusCode =
      error.statusCode || error instanceof mongoose.Error
        ? httpStatus.BAD_REQUEST
        : httpStatus.INTERNAL_SERVER_ERROR;
    const message = error.message || httpStatus[statusCode];
    error = new ApiError(statusCode, message, false, err.stack);
  }
  next(error);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;
  // if (process.env.NODE_ENV === 'production' && !err.isOperational) {
  //   statusCode = httpStatus.INTERNAL_SERVER_ERROR;
  //   message = httpStatus[httpStatus.INTERNAL_SERVER_ERROR];
  // }

  res.locals.errorMessage = err.message; // For potential server-side logging/rendering

  const response = {
    status: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }), // Include stack trace in dev
  };

  if (process.env.NODE_ENV === 'development') {
    logger.error(err);
  }

  res.status(statusCode).send(response);
};


const handleUploadError = (err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: false,
      message: err.message
    });
  }

  // Handle unexpected form endings
  if (err.message === 'Unexpected end of form') {
    return res.status(400).json({
      status: false,
      message: 'File upload was interrupted. Please try again.'
    });
  }

  next(err);
};

module.exports = {
  errorConverter,
  errorHandler,
  handleUploadError,
};
