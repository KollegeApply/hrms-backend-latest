const httpStatus = require('http-status-codes');
const holidayService = require('../services/holidayService');
const holidayValidator = require('../validators/holidayValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');

// Create a new holiday
const createHoliday = catchAsync(async (req, res) => {
  const holidayName = req?.body?.name;
  const holidayDate = req?.body?.date;
  const userId = req?.user?.id;

  const validatedData =
    await holidayValidator?.createHolidaySchema?.validateAsync({
      name: holidayName,
      date: holidayDate,
      userId: userId,
    });
  const holiday = await holidayService?.createHoliday(validatedData);

  res?.status(httpStatus.CREATED).json({
    status: true,
    message: 'Holiday created successfully.',
    data: holiday,
  });
});

// Get all holidays
const getAllHolidays = catchAsync(async (req, res) => {
  const holidays = await holidayService?.getAllHoliday();

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Holidays retrieved successfully.',
    data: holidays,
  });
});

// Get holiday by Id
const getHolidayById = catchAsync(async (req, res) => {
  const validatedData = await holidayValidator?.holidayIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const holidayFound = await holidayService?.getHolidayById(validatedData);
  if (!holidayFound) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Holiday not found.');
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Holiday retrieved successfully.',
    data: holidayFound,
  });
});

// Update holiday
const updateHoliday = catchAsync(async (req, res) => {
  const holidayId = req?.params?.id;
  const name = req?.body?.name;
  const date = req?.body?.date;
  const validatedData =
    await holidayValidator?.updateHolidaySchema?.validateAsync({
      holidayId,
      name,
      date,
    });
  const updated = await holidayService?.updateHoliday(validatedData);

  if (!updated) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Holiday not found or update failed.'
    );
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Holiday updated successfully.',
    data: updated,
  });
});

// Delete holiday
const deleteHoliday = catchAsync(async (req, res) => {
  const validatedData = await holidayValidator?.holidayIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const deleted = await holidayService?.deleteHoliday(validatedData);
  if (!deleted) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Holiday not found.');
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Holiday deleted successfully.',
    data: deleted,
  });
});

// Check if a date is a holiday
const checkHoliday = catchAsync(async (req, res) => {
  const { date } = req.query;
  
  if (!date) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Date parameter is required.');
  }

  const isHoliday = await holidayService?.isHoliday(new Date(date));

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Holiday check completed.',
    data: { isHoliday, date },
  });
});

module.exports = {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
  checkHoliday,
};
