const httpStatus = require('http-status-codes');
const personalEventService = require('../services/personalEventService');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');

// Create a new personal event
const createPersonalEvent = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const eventData = {
    ...req.body,
    userId: userId
  };

  const event = await personalEventService.createPersonalEvent(eventData);

  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Personal event created successfully.',
    data: event,
  });
});

// Get all personal events for a user
const getPersonalEvents = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { year, month, startDate, endDate } = req.query;

  let events;
  if (year && month) {
    // Get events for specific month
    events = await personalEventService.getPersonalEventsByMonth(
      userId, 
      parseInt(year), 
      parseInt(month)
    );
  } else if (startDate && endDate) {
    // Get events for date range
    events = await personalEventService.getPersonalEventsByUserId(
      userId,
      new Date(startDate),
      new Date(endDate)
    );
  } else {
    // Get all events for user
    events = await personalEventService.getPersonalEventsByUserId(userId);
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Personal events retrieved successfully.',
    data: events,
  });
});

// Get a personal event by ID
const getPersonalEventById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const event = await personalEventService.getPersonalEventById(id, userId);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Personal event retrieved successfully.',
    data: event,
  });
});

// Update a personal event
const updatePersonalEvent = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const updateData = req.body;

  const event = await personalEventService.updatePersonalEvent(id, userId, updateData);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Personal event updated successfully.',
    data: event,
  });
});

// Delete a personal event
const deletePersonalEvent = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const event = await personalEventService.deletePersonalEvent(id, userId);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Personal event deleted successfully.',
    data: event,
  });
});

module.exports = {
  createPersonalEvent,
  getPersonalEvents,
  getPersonalEventById,
  updatePersonalEvent,
  deletePersonalEvent,
};
