const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const LeaveApplication = require('../models/leaveApplicationModel');
const { startOfDay, endOfDay, parseISO, isValid } = require('date-fns');
const moment = require('moment-timezone');

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
      const now = moment().tz('Asia/Kolkata');
      const today = now.clone().startOf('day'); 

      // Check for any existing attendance record for today
      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: today.toDate(),
      });

      if (existingAttendance && existingAttendance.checkInTime) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Already checked in today.',
        };
      }

      // Check if user has any leave applied for today
      const leaveAttendance = await Attendance.findOne({
        user: userId,
        date: today.toDate(),
        status: { 
          $in: ['leave_applied_first_half', 'leave_applied_second_half', 'leave_applied_full'] 
        },
      });

      // Determine status based on check-in time and leave status
      let status = 'present';
      const checkInHour = now.hour();
      const checkInMinute = now.minute();
      const checkInTimeInMinutes = checkInHour * 60 + checkInMinute;

      // Check if it's a first half leave (check-in after 2:30 PM)
      const firstHalfLeaveCutoff = 14 * 60 + 30; // 2:30 PM in minutes
      
      // Normal cutoff time (10:15 AM)
      const normalCutoff = 10 * 60 + 15; // 10:15 AM in minutes

      if (leaveAttendance) {
        // User has leave applied
        if (leaveAttendance.status === 'leave_applied_first_half') {
          // First half leave - check-in after 2:30 PM = late_in
          if (checkInTimeInMinutes > firstHalfLeaveCutoff) {
            status = 'late_in';
          }
        } else if (leaveAttendance.status === 'leave_applied_second_half') {
          // Second half leave - check-in after 10:15 AM = late_in
          if (checkInTimeInMinutes > normalCutoff) {
            status = 'late_in';
          }
        } else if (leaveAttendance.status === 'leave_applied_full') {
          // Full day leave - should not check in, but if they do, mark as late_in
          status = 'late_in';
        }
      } else {
        // No leave applied
        if (checkInTimeInMinutes > normalCutoff) {
          // Check-in after 10:15 AM without leave = late_in
          status = 'late_in';
        }
      }

      let attendance;
      
      if (leaveAttendance) {
        // Update existing leave attendance record with check-in details
        attendance = leaveAttendance;
        attendance.checkInTime = now;
        attendance.checkInLocation = { latitude, longitude };
        attendance.status = status;
        if (checkInMode) {
          attendance.checkInMode = checkInMode;
        }
        await attendance.save();
      } else {
        // Create new attendance record
        attendance = new Attendance({
          user: userId,
          checkInTime: now,
          checkInLocation: { latitude, longitude },
          date: today,
          status: status,
          ...(checkInMode && { checkInMode }),
        });
        await attendance.save();
      }
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

  // async createAttendance(userId, status, Id, date, updateIn) {
  //   try {
  //     const existingAttendace = await Attendance.findOne({
  //       user: userId,
  //       date: date,
  //     });
  //     if (existingAttendace) {
  //       // For now, keep the old logic but we'll need to update this based on leave type
  //       existingAttendace.status =
  //         updateIn === 'leave' ? 'leave_applied_full' : 'wfh_applied';
  //       if (updateIn === 'leave') {
  //         existingAttendace.leaveId = Id;
  //       } else if (updateIn === 'wfh') {
  //         existingAttendace.wfhId = Id;
  //       }
  //       await existingAttendace.save();
  //       return {
  //         status: 'success',
  //         statusCode: 201,
  //         message: 'Data changed successfully.',
  //         data: existingAttendace,
  //       };
  //     }
  //     const newAttendance = new Attendance({
  //       user: userId,
  //       status: updateIn === 'leave' ? 'leave_applied_full' : 'wfh_applied',
  //       leaveId: updateIn === 'leave' ? Id : undefined,
  //       wfhId: updateIn === 'wfh' ? Id : undefined,
  //       date: date,
  //     });
  //     await newAttendance.save();
  //     return {
  //       status: 'success',
  //       statusCode: 201,
  //       message: 'Attendace created.',
  //       data: newAttendance,
  //     };
  //   } catch (err) {
  //     console.error(
  //       `Error occured while registering ${status} on date : ${date}. Error: `,
  //       err
  //     );
  //     return {
  //       status: 'error',
  //       statusCode: 500,
  //       message: 'Failed to create attendance.',
  //     };
  //   }
  // },

  async markCheckOut(userId, latitude, longitude, checkOutMode) {
    try {
      const now = moment().tz('Asia/Kolkata');
      const today = now.clone().startOf('day');

      const attendance = await Attendance.findOne({
        user: userId,
        date: today.toDate(),
        checkOutTime: null,
        status: { $in: ['present', 'late_in', 'early_out', 'late_in_early_out'] },
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

      // Calculate work duration using moment timezone
      const workDurationMs = now.diff(moment(attendance.checkInTime).tz('Asia/Kolkata'));
      const workDurationHours = workDurationMs / (1000 * 60 * 60); // Convert to hours
      
      // Required work hours
      const requiredWorkHours = 9; // 9 hours
      const halfDayWorkHours = 4.5; // 4.5 hours for half day leave

      // Determine half-day leave via linkage first, fallback to legacy status
      let hasHalfDayLeave = false;
      if (attendance.leaveId) {
        try {
          const linkedLeave = await LeaveApplication.findById(attendance.leaveId).select('isHalfDay halfDayType');
          hasHalfDayLeave = !!linkedLeave && linkedLeave.isHalfDay === true;
        } catch (_) {
          hasHalfDayLeave = false;
        }
      }
      let newStatus = attendance.status; // Keep previous status by default

      if (hasHalfDayLeave) {
        // User has half-day leave applied (detected via linkage)
        if (workDurationHours < halfDayWorkHours) {
          // Worked less than 4.5 hours in the working half
          if (attendance.status === 'present') {
            newStatus = 'early_out';
          } else if (attendance.status === 'late_in') {
            newStatus = 'late_in_early_out';
          }
        }
        // If worked >= 4.5 hours, keep previous status (present or late_in)
      } else {
        // No leave applied - check for 9 hours
        if (workDurationHours < requiredWorkHours) {
          // Worked less than 9 hours
          if (attendance.status === 'present') {
            newStatus = 'early_out';
          } else if (attendance.status === 'late_in') {
            newStatus = 'late_in_early_out';
          }
        }
        // If worked >= 9 hours, keep previous status (present or late_in)
      }

      // Update status
      attendance.status = newStatus;

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

      if (existingAttendance && !['present', 'late_in', 'early_out', 'late_in_early_out'].includes(existingAttendance?.status)) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Attendance already marked for today.',
        };
      }

      const attendance = await Attendance.findOneAndUpdate(
        { user: userId, date: today },
        { status: 'leave_applied_full', leaveReason },
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

      if (existingAttendance && !['present', 'late_in', 'early_out', 'late_in_early_out'].includes(existingAttendance?.status)) {
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


async getTeamMembers(leaderId) {
  const teamUsers = await User.find(
    {
      $or: [
        { teamLeadId: leaderId },
        { subTeamLeadId: leaderId }
      ]
    },
    '_id'
  );
  return teamUsers.map((u) => u._id);
},

  async getAttendance(userId, role, startDateStr, endDateStr) {
    try {
      let startDate, endDate;
      let dateQuery = {};

      if (startDateStr && endDateStr) {
        // Parse dates using moment timezone for consistency
        const parsedStart = moment(startDateStr).tz('Asia/Kolkata');
        const parsedEnd = moment(endDateStr).tz('Asia/Kolkata');

        if (parsedStart.isValid() && parsedEnd.isValid()) {
          startDate = parsedStart.startOf('day');
          endDate = parsedEnd.endOf('day');

          if (startDate.isAfter(endDate)) {
            return {
              status: 'error',
              statusCode: 400,
              message: 'Start date cannot be after end date.',
            };
          }
          dateQuery = { $gte: startDate.toDate(), $lte: endDate.toDate() };
        } else {
          return {
            status: 'error',
            statusCode: 400,
            message: 'Invalid date format. Please use YYYY-MM-DD.',
          };
        }
      } else {
        // Default to current month if no range is provided
        const now = moment().tz('Asia/Kolkata');
        startDate = now.clone().startOf('month').startOf('day');
        endDate = now.clone().endOf('month').endOf('day');
       
        dateQuery = { $gte: startDate.toDate(), $lte: endDate.toDate() };
      }
      
      let query = { date: dateQuery };

      // Check if user is Finance department teamlead
      let isFinanceTeamlead = false;
      if (role === 'teamlead') {
        const userWithDept = await User.findById(userId).populate('department', 'name').lean();
        isFinanceTeamlead = userWithDept?.department?.name?.toLowerCase()?.trim() === 'finance';
      }

      // Finance teamlead should see all attendance data like HR/Admin
      if (['teamlead', 'subteamlead'].includes(role) && !isFinanceTeamlead) {
        const teamMemberIds = await this.getTeamMembers(userId);
        query.user = { $in: [userId, ...teamMemberIds] };
      } else if (!['hr', 'subadmin', 'admin'].includes(role) && !isFinanceTeamlead) {
        query.user = userId;
      }
      // For HR/Admin/SubAdmin or Finance teamlead, no user filter is applied (they see all attendance)

      const attendance = await Attendance.find(query)
        .populate('user', '_id firstName lastName employeeId workType hireDate')
        .populate('leaveId')
        .populate('wfhId')
        .sort({ date: -1, checkInTime: -1 })
        .lean();

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
      const now = moment().tz('Asia/Kolkata');
      const todayStart = now.clone().startOf('day');
      const todayEnd = now.clone().endOf('day');

      const attendance = await Attendance.findOne({
        user: userId,
        date: { $gte: todayStart.toDate(), $lte: todayEnd.toDate() },
      })
        .sort({ checkInTime: -1 })
        .select('checkInTime status checkInMode checkOutMode checkOutTime')
        .lean();

      if (attendance) {
        // Determine if user is currently checked in
        const isCheckedIn = attendance.checkInTime && !attendance.checkOutTime;
        
        // Determine display status based on current attendance state
        let displayStatus = attendance.status;
        
        // If user is checked in but status is early_out or late_in_early_out, 
        // they might be in the middle of their work day, so show appropriate status
        if (isCheckedIn) {
          if (attendance.status === 'early_out' || attendance.status === 'late_in_early_out') {
            // User is still working, show the base status
            displayStatus = attendance.status === 'late_in_early_out' ? 'late_in' : 'present';
          }
        }

        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn: isCheckedIn,
            checkInTime: attendance.checkInTime,
            status: displayStatus, // Updated status handling
            checkInMode: attendance.checkInMode,
            checkOutMode: attendance.checkOutMode,
            checkOutTime: attendance.checkOutTime, // Added for frontend reference
          },
        };
      } else {
        return {
          status: 'success',
          statusCode: 200,
          data: {
            isCheckedIn: false,
            checkInTime: null,
            status: 'absent', // No attendance record for today
            checkInMode: null,
            checkOutMode: null,
            checkOutTime: null,
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

  async bulkCreateOrUpdateLeaveAttendance(userId, leaveId, dates, isHalfDay = false, halfDayType = null, leaveTypeCode = null) {
    try {
      if (!Array.isArray(dates) || dates.length === 0) {
        throw new Error('No dates provided for bulk leave attendance.');
      }

      // Determine the attendance status based on half-day information (same for all leave types)
      let attendanceStatus = 'leave_applied_full';
      if (isHalfDay) {
        if (halfDayType === 'first') {
          attendanceStatus = 'leave_applied_first_half';
        } else if (halfDayType === 'second') {
          attendanceStatus = 'leave_applied_second_half';
        }
      }

      const attendanceOps = dates.map((date) => {
        const standardizedDate = moment(date).tz('Asia/Kolkata').startOf('day').toDate();

        return {
          updateOne: {
            filter: { user: userId, date: standardizedDate },
            update: {
              $set: {
                user: userId,
                date: standardizedDate,
                status: attendanceStatus,
                leaveId,
              },
            },
            upsert: true,
          },
        };
      });

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
      const standardizedDates = leaveDates.map((date) =>
        moment(date).tz('Asia/Kolkata').startOf('day').toDate()
      );

      const result = await Attendance.deleteMany({
        user: userId,
        leaveId: leaveId,
        date: { $in: standardizedDates },
      });

    } catch (err) {
      console.error('❌ Failed to revert leave attendance:', err);
      throw err;
    }
  },
};

module.exports = attendanceService;
