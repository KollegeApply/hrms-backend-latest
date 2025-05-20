const logger = require('../config/logger');
const attendanceService = require('../services/attendanceService');
const requestService = require('../services/requestService');
const ApiError = require('../utility/ApiError');
const mongoose = require('mongoose');
// const VALID_USER_ROLES = require('../utility/constants')

exports.markCheckIn = async (req, res) => {
  const { latitude, longitude, checkInMode } = req.body;
  const userId = req?.user?.id;

  const result = await attendanceService.markCheckIn(
    userId,
    latitude,
    longitude,
    checkInMode
  );
  return res.status(result?.statusCode).json({
    message: result?.message,
    ...(result?.data && { data: result?.data }),
  });
};

exports.markCheckOut = async (req, res) => {
  const { latitude, longitude, checkOutMode } = req.body;
  const userId = req?.user?.id;

  const result = await attendanceService.markCheckOut(
    userId,
    latitude,
    longitude,
    checkOutMode
  );
  return res.status(result.statusCode).json({
    message: result?.message,
    ...(result?.data && { data: result?.data }),
  });
};

exports.applyForLeave = async (req, res) => {
  const { leaveReason } = req.body;
  const userId = req?.user?.id;

  if (!leaveReason) {
    return res?.status(400)?.json({ message: 'Leave reason is required.' });
  }

  const result = await attendanceService.applyForLeave(userId, leaveReason);
  return res?.status(result?.statusCode).json({
    message: result?.message,
    ...(result?.data && { data: result?.data }),
  });
};

exports.applyForWFH = async (req, res) => {
  const { wfhReason } = req.body;
  const userId = req?.user?.id;

  if (!wfhReason) {
    return res
      .status(400)
      .json({ message: 'Work from home reason is required.' });
  }

  const result = await attendanceService.applyForWFH(userId, wfhReason);
  return res?.status(result?.statusCode).json({
    message: result?.message,
    ...(result?.data && { data: result?.data }),
  });
};

exports.getAttendance = async (req, res) => {
  try {
    const { userId } = req?.params;
    const role = req?.user?.role;
    const { userRole, startDate, endDate } = req.query;
    const result = await attendanceService.getAttendance(
      userId,
      role,
      startDate,
      endDate
    );
    if (
      userRole === 'hr' ||
      userRole === 'admin' ||
      userRole === 'subadmin' ||
      userRole == 'teamlead'
    ) {
      const requestReponse = await requestService.getAllRequests();
      return res.status(result.statusCode || 200).json({
        result: {
          attendance: result.data,
          requests: requestReponse,
        },
      });
    } else {
      const requestResponse = await requestService.getRequestsByUser({
        userId: new mongoose.Types.ObjectId(userId),
      });
      return res.status(result.statusCode || 200).json({
        // Default to 200 if no statusCode from service
        result: {
          attendance: result.data,
          requests: requestResponse,
        }, // Maintaining variable name
      });
    }
  } catch (error) {
    console.error('Error in getAttendance controller:', error);
    return res
      .status(500)
      .json({ message: 'An unexpected server error occurred.' });
  }
};

exports.getTodayCheckIn = async (req, res) => {
  const userId = req?.user?.id;

  const result = await attendanceService.getTodayCheckInStatus(userId);
  return res
    .status(result?.statusCode)
    .json(result?.data ? result?.data : { message: result?.message });
};
