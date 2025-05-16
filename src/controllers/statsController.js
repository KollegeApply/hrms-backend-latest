const httpStatus = require('http-status-codes');
const statsService = require('../services/statsService');
const statsValidator = require('../validators/statsValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');

// Monthly Stats
const getMonthlyStats = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const validatedData = await statsValidator.monthlyStatsSchema.validateAsync({
    userId,
  });

  const data = await statsService.getMonthlyStats(validatedData);

  if (!data || data.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No monthly stats found.');
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Monthly stats retrieved successfully.',
    data,
  });
});

// Yearly Stats
const getYearlyStats = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const validatedData = await statsValidator.yearlyStatsSchema.validateAsync({
    userId,
  });

  const data = await statsService.getYearlyStats(validatedData);

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Yearly stats retrieved successfully.',
    data,
  });
});

// // Leave Stats
const getLeaveStats = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const validatedData = await statsValidator.leaveStatsSchema.validateAsync({
    userId,
  });

  const data = await statsService.getLeaveStats(validatedData);

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave stats retrieved successfully.',
    data,
  });
});

module.exports = {
  getMonthlyStats,
  getYearlyStats,
  getLeaveStats,
};
