const Attendance = require('../models/attendanceModel');
const { startOfDay, endOfDay, parseISO, isValid } = require('date-fns');

// Helper function to get the start and end of the current month
const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = startOfDay(
    new Date(now?.getFullYear(), now?.getMonth(), 1)
  );
  const endOfMonth = endOfDay(
    new Date(now?.getFullYear(), now?.getMonth() + 1, 0)
  );
  return { startOfMonth, endOfMonth };
};

const attendanceService = {
  async markCheckIn(userId, latitude, longitude, checkInMode) {
    try {
      const now = new Date();
      const today = new Date(
        now?.getFullYear(),
        now?.getMonth(),
        now?.getDate()
      );

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
        checkOutTime: null,
        status: 'present',
      });

      if (existingAttendance) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Already checked in today.',
        };
      }

      const attendance = new Attendance({
        user: userId,
        checkInTime: now,
        checkInLocation: { latitude, longitude },
        date: today,
        ...(checkInMode && { checkInMode }),
      });

      await attendance.save();
      return {
        status: 'success',
        statusCode: 201,
        message: 'Check-in successful.',
        data: attendance,
      };
    } catch (error) {
      console.error('Error marking check-in in service:', error);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to mark check-in.',
      };
    }
  },

  async createAttendance(userId, status, Id, date, updateIn) {
    try {
      const existingAttendace = await Attendance.findOne({
        user: userId,
        date: date,
      });
      if (existingAttendace) {
        existingAttendace.status =
          updateIn === 'leave' ? 'leave_applied' : 'wfh_applied';
        if (updateIn === 'leave') {
          existingAttendace.leaveId = Id;
        } else if (updateIn === 'wfh') {
          existingAttendace.wfhId = Id;
        }
        await existingAttendace.save();
        return {
          status: 'success',
          statusCode: 201,
          message: 'Data changed successfully.',
          data: existingAttendace,
        };
      }
      const newAttendance = new Attendance({
        user: userId,
        status: updateIn === 'leave' ? 'leave_applied' : 'wfh_applied',
        leaveId: updateIn === 'leave' ? Id : undefined,
        wfhId: updateIn === 'wfh' ? Id : undefined,
        date: date,
      });
      await newAttendance.save();
      return {
        status: 'success',
        statusCode: 201,
        message: 'Attendace created.',
        data: newAttendance,
      };
    } catch (err) {
      console.error(
        `Error occured while registering ${status} on date : ${date}. Error: `,
        err
      );
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to create attendance.',
      };
    }
  },

  async markCheckOut(userId, latitude, longitude, checkOutMode) {
    try {
      const now = new Date();
      const today = new Date(
        now?.getFullYear(),
        now?.getMonth(),
        now?.getDate()
      );

      const attendance = await Attendance.findOne({
        user: userId,
        date: today,
        checkOutTime: null,
        status: 'present',
      });

      if (!attendance) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Not checked in today.',
        };
      }

      attendance.checkOutTime = now;
      attendance.checkOutLocation = { latitude, longitude };

      if (checkOutMode) {
        attendance.checkOutMode = checkOutMode;
      }
      await attendance.save();
      return {
        status: 'success',
        statusCode: 200,
        message: 'Check-out successful.',
        data: attendance,
      };
    } catch (error) {
      console.error('Error marking check-out in service:', error);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to mark check-out.',
      };
    }
  },

  async applyForLeave(userId, leaveReason) {
    try {
      const now = new Date();
      const today = new Date(
        now?.getFullYear(),
        now?.getMonth(),
        now?.getDate()
      );

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
      });

      if (existingAttendance && existingAttendance?.status !== 'present') {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Attendance already marked for today.',
        };
      }

      const attendance = await Attendance.findOneAndUpdate(
        { user: userId, date: today },
        { status: 'leave_applied', leaveReason },
        { upsert: true, new: true }
      );

      return {
        status: 'success',
        statusCode: 200,
        message: 'Leave application submitted.',
        data: attendance,
      };
    } catch (error) {
      console.error('Error applying for leave in service:', error);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to apply for leave.',
      };
    }
  },

  async applyForWFH(userId, wfhReason) {
    try {
      const now = new Date();
      const today = new Date(
        now?.getFullYear(),
        now?.getMonth(),
        now?.getDate()
      );

      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today,
      });

      if (existingAttendance && existingAttendance?.status !== 'present') {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Attendance already marked for today.',
        };
      }

      const attendance = await Attendance.findOneAndUpdate(
        { user: userId, date: today },
        { status: 'wfh_applied', wfhReason },
        { upsert: true, new: true }
      );

      return {
        status: 'success',
        statusCode: 200,
        message: 'Work from home application submitted.',
        data: attendance,
      };
    } catch (error) {
      console.error('Error applying for WFH in service:', error);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to apply for work from home.',
      };
    }
  },

  async getAttendance(userId, role, startDateStr, endDateStr) {
    try {
      let startDate, endDate;
      let dateQuery = {};

      if (startDateStr && endDateStr) {
        const parsedStart = parseISO(startDateStr);
        const parsedEnd = parseISO(endDateStr);

        if (isValid(parsedStart) && isValid(parsedEnd)) {
          startDate = startOfDay(parsedStart);
          endDate = endOfDay(parsedEnd);

          if (startDate > endDate) {
            return {
              status: 'error',
              statusCode: 400,
              message: 'Start date cannot be after end date.',
            };
          }

          // console.log(
          //   `Using date range: ${startDate.toISOString()} to ${endDate.toISOString()}`
          // );
          dateQuery = { $gte: startDate, $lte: endDate };
        } else {
          return {
            status: 'error',
            statusCode: 400,
            message: 'Invalid date format. Please use YYYY-MM-DD.',
          };
        }
      } else {
        // Default to current month if no range is provided
        const defaultRange = getCurrentMonthRange();
        startDate = defaultRange?.startOfMonth;
        endDate = defaultRange?.endOfMonth;
        console.log(
          `Default: ${startDate.toISOString()} to ${endDate.toISOString()}`
        );
        dateQuery = { $gte: startDate, $lte: endDate };
      }
      let query = { date: dateQuery };

      if (role !== 'hr' && role !== 'subadmin' && role !== 'admin') {
        query.user = userId;
      }
      const attendance = await Attendance.find(query)
        .populate('user', 'firstName lastName employeeId workType')
        .populate('leaveId')
        .sort({ date: -1, checkInTime: -1 });
      return {
        status: 'success',
        statusCode: 200,
        data: attendance,
      };
    } catch (error) {
      console.error('Error fetching attendance in service:', error);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to fetch attendance data.',
      };
    }
  },

  async getTodayCheckInStatus(userId) {
    try {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      );
      const todayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
      );

      const attendance = await Attendance.findOne({
        user: userId,
        date: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ checkInTime: -1 })
        .select('checkInTime status checkInMode checkOutMode checkOutTime')
        .lean();

      if (attendance) {
        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn:
              attendance.checkInTime && attendance.checkOutTime ? false : true,
            checkInTime: attendance.checkInTime,
            status: attendance.status, // can be 'present', 'leave_applied', or 'wfh_applied'
            checkInMode: attendance.checkInMode,
            checkOutMode: attendance.checkOutMode,
          },
        };
      } else {
        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn: false,
            checkInTime: null,
            status: 'absent', // optional fallback
            checkInMode: null, // optional fallback
            checkOutMode: null,
          },
        };
      }
    } catch (error) {
      console.error(
        "Error fetching today's check-in status in service:",
        error
      );
      return {
        status: 'error',
        statusCode: 500,
        message: "Failed to fetch today's check-in status.",
      };
    }
  },

  async bulkCreateOrUpdateLeaveAttendance(userId, leaveId, dates) {
    try {
      if (!Array.isArray(dates) || dates.length === 0) {
        throw new Error('No dates provided for bulk leave attendance.');
      }

      const attendanceOps = dates.map((date) => ({
        updateOne: {
          filter: { user: userId, date },
          update: {
            $set: {
              user: userId,
              date,
              status: 'leave_applied',
              leaveId,
            },
          },
          upsert: true,
        },
      }));

      await Attendance.bulkWrite(attendanceOps);

      return {
        status: 'success',
        statusCode: 200,
        message: 'Bulk attendance updated successfully.',
      };
    } catch (err) {
      console.error('Error in bulk attendance update:', err);
      return {
        status: 'error',
        statusCode: 500,
        message: 'Failed to perform bulk attendance update.',
      };
    }
  },

  async bulkRevertLeaveAttendance(userId, leaveId, leaveDates) {
    if (!Array.isArray(leaveDates) || leaveDates.length === 0) return;

    try {
      const result = await Attendance.deleteMany({
        user: userId,
        leaveId: leaveId,
        date: { $in: leaveDates.map((date) => new Date(date)) },
      });

      console.log(
        `✅ Reverted ${result.deletedCount} leave attendance records for user ${userId}`
      );
    } catch (err) {
      console.error('❌ Failed to revert leave attendance:', err);
      throw err;
    }
  },
};

module.exports = attendanceService;
