const Attendance = require('../models/attendanceModel');

// Helper function to get the start and end of the current month
const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { startOfMonth, endOfMonth };
};

const attendanceService = {
  async markCheckIn(userId, latitude, longitude) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
        checkOutTime: null,
        status: 'present',
      });

      if (existingAttendance) {
        return { status: 'error', statusCode: 400, message: 'Already checked in today.' };
      }

      const attendance = new Attendance({
        user: userId,
        checkInTime: now,
        checkInLocation: { latitude, longitude },
        date: today,
      });

      await attendance.save();
      return { status: 'success', statusCode: 201, message: 'Check-in successful.', data: attendance };
    } catch (error) {
      console.error('Error marking check-in in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to mark check-in.' };
    }
  },

  async markCheckOut(userId, latitude, longitude) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const attendance = await Attendance.findOne({
        user: userId,
        date: today,
        checkOutTime: null,
        status: 'present',
      });

      if (!attendance) {
        return { status: 'error', statusCode: 400, message: 'Not checked in today.' };
      }

      attendance.checkOutTime = now;
      attendance.checkOutLocation = { latitude, longitude };
      await attendance.save();
      return { status: 'success', statusCode: 200, message: 'Check-out successful.', data: attendance };
    } catch (error) {
      console.error('Error marking check-out in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to mark check-out.' };
    }
  },

  async applyForLeave(userId, leaveReason) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
      });

      if (existingAttendance && existingAttendance.status !== 'present') {
        return { status: 'error', statusCode: 400, message: 'Attendance already marked for today.' };
      }

      const attendance = await Attendance.findOneAndUpdate(
        { user: userId, date: today },
        { status: 'leave_applied', leaveReason },
        { upsert: true, new: true }
      );

      return { status: 'success', statusCode: 200, message: 'Leave application submitted.', data: attendance };
    } catch (error) {
      console.error('Error applying for leave in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to apply for leave.' };
    }
  },

  async applyForWFH(userId, wfhReason) {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
      });

      if (existingAttendance && existingAttendance.status !== 'present') {
        return { status: 'error', statusCode: 400, message: 'Attendance already marked for today.' };
      }

      const attendance = await Attendance.findOneAndUpdate(
        { user: userId, date: today },
        { status: 'wfh_applied', wfhReason },
        { upsert: true, new: true }
      );

      return { status: 'success', statusCode: 200, message: 'Work from home application submitted.', data: attendance };
    } catch (error) {
      console.error('Error applying for WFH in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to apply for work from home.' };
    }
  },

  async getAttendance(userId, role) {
    try {
      const { startOfMonth, endOfMonth } = getCurrentMonthRange();
      let query = { date: { $gte: startOfMonth, $lte: endOfMonth } };

      if (role === 'employee') {
        query.user = userId;
      } else if (role !== 'hr' && role !== 'manager' && role !== 'admin') {
        return { status: 'error', statusCode: 403, message: 'Unauthorized to view attendance.' };
      }

      const attendance = await Attendance.find(query).populate('user', 'firstName lastName employeeId');
      return { status: 'success', statusCode: 200, data: attendance };
    } catch (error) {
      console.error('Error fetching attendance in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to fetch attendance.' };
    }
  },

  async getTodayCheckInStatus(userId) {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const attendance = await Attendance.findOne({
        user: userId,
        date: { $gte: todayStart, $lte: todayEnd },
        checkOutTime: null,
        status: 'present',
      }).select('checkInTime'); // Only select the checkInTime field

      if (attendance) {
        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn: true,
            checkInTime: attendance.checkInTime,
          },
        };
      } else {
        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn: false,
            checkInTime: null,
          },
        };
      }
    } catch (error) {
      console.error('Error fetching today\'s check-in status in service:', error);
      return { status: 'error', statusCode: 500, message: 'Failed to fetch today\'s check-in status.' };
    }
  },

};

module.exports = attendanceService;