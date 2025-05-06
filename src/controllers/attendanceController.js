const attendanceService = require('../services/attendanceService');

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
  const { latitude, longitude } = req.body;
  const userId = req?.user?.id;

  const result = await attendanceService.markCheckOut(
    userId,
    latitude,
    longitude
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
    const userId = req?.user?.id;
    const role = req?.user?.role;
    const { startDate, endDate } = req.query;

    const result = await attendanceService.getAttendance(
      userId,
      role,
      startDate,
      endDate
    );

    return res.status(result.statusCode).json(result.data);
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
