const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const LeaveApplication = require('../models/leaveApplicationModel');
const { startOfDay, endOfDay } = require('date-fns');
const moment = require('moment-timezone');
const { calculateBiometricStatus } = require('./biometricWebhookService');

const LEAVE_ATTENDANCE_STATUSES = [
  'leave_applied',
  'leave_applied_full',
  'leave_applied_first_half',
  'leave_applied_second_half',
];

const PENDING_WORKFLOW_STATUSES = ['tl-pending', 'hr-pending'];

/**
 * Applies the same leave/regularisation display overrides used for `status`
 * to any attendance status field (e.g. `biometricStatus`).
 */
const resolveAttendanceDisplayStatus = (record, baseStatus) => {
  const regStatus = record?.regularization?.status;
  if (regStatus === 'approved') return 'present';
  if (PENDING_WORKFLOW_STATUSES.includes(regStatus)) return regStatus;

  const leaveStatus = record?.leaveId?.status;
  if (PENDING_WORKFLOW_STATUSES.includes(leaveStatus)) return leaveStatus;

  return baseStatus;
};

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
      const dayStartIST = now.clone().startOf('day');
      const attendanceDate = dayStartIST.clone().utc().toDate();
      const endOfDay = dayStartIST.clone().add(1, 'day').utc().toDate();

      // Fetch user's shiftTime from user model
      const user = await User.findById(userId).select('shiftTime').lean();
      const shiftTime = user?.shiftTime || null; // Store shiftTime in variable

      // Calculate shiftTime in minutes (similar to normalCutoff calculation)
      let shiftTimeInMinutes = null;
      if (shiftTime) {
        // Parse shiftTime string (format: "HH:MM" or "H:MM")
        const timeParts = shiftTime.split(':');
        if (timeParts.length === 2) {
          const hours = parseInt(timeParts[0], 10);
          const minutes = parseInt(timeParts[1], 10);
          if (!isNaN(hours) && !isNaN(minutes)) {
            shiftTimeInMinutes = hours * 60 + minutes;
          }
        }
      }

      // Check for any existing attendance record for today
      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: { $gte: attendanceDate, $lt: endOfDay },
        checkInTime: { $ne: null },
      }).sort({ createdAt: -1 });

      const alreadyCheckedInToday = !!(existingAttendance && existingAttendance.checkInTime);

      // Check if user has any leave applied for today
      const leaveAttendance = await Attendance.findOne({
        user: userId,
        date: { $gte: attendanceDate, $lt: endOfDay },
        status: { 
          $in: ['leave_applied_first_half', 'leave_applied_second_half', 'leave_applied_full'] 
        },
      });

      // Determine status based on check-in time and leave status
      let status = 'present';
      const checkInHour = now.hour();
      const checkInMinute = now.minute();
      const checkInTimeInMinutes = checkInHour * 60 + checkInMinute;

      // Normal cutoff time (10:15 AM) - default fallback
      const normalCutoff = 10 * 60 + 15; // 10:15 AM in minutes
      
      // Use shiftTimeInMinutes if available, otherwise fallback to normalCutoff
      const cutoffTime = shiftTimeInMinutes !== null ? shiftTimeInMinutes : normalCutoff;
      

      // First half leave cutoff: shiftTime + 4 hours 15 minutes, or default 2:30 PM
      const defaultFirstHalfLeaveCutoff = 14 * 60 + 30; // 2:30 PM in minutes (default)
      const fourHoursFifteenMinutes = 4 * 60 + 15; // 4 hours 15 minutes in minutes
      const firstHalfLeaveCutoff = shiftTimeInMinutes !== null 
        ? shiftTimeInMinutes + fourHoursFifteenMinutes 
        : defaultFirstHalfLeaveCutoff;
        

      if (leaveAttendance) {
        // User has leave applied
        if (leaveAttendance.status === 'leave_applied_first_half') {
          // First half leave - check-in after 2:30 PM = late_in
          if (checkInTimeInMinutes > firstHalfLeaveCutoff) {
            status = 'late_in';
          }
        } else if (leaveAttendance.status === 'leave_applied_second_half') {
          // Second half leave - check-in after cutoff time = late_in
          if (checkInTimeInMinutes > cutoffTime) {
            status = 'late_in';
          }
        } else if (leaveAttendance.status === 'leave_applied_full') {
          // Full day leave - should not check in, but if they do, mark as late_in
          // status = 'late_in';
          if (checkInTimeInMinutes > cutoffTime) {
            // Check-in after cutoff time without leave = late_in
            status = 'late_in';
          }
        }
      } else {
        // No leave applied
        if (checkInTimeInMinutes > cutoffTime) {
          // Check-in after cutoff time without leave = late_in
          status = 'late_in';
        }
      }

      let attendance = existingAttendance;
      
      if (!alreadyCheckedInToday) {
        if (leaveAttendance) {
          // Update existing leave attendance record with check-in details
          attendance = leaveAttendance;
          attendance.checkInTime = now.toDate();
          attendance.checkInLocation = { latitude, longitude };
          attendance.status = status;
          if (checkInMode) {
            attendance.checkInMode = checkInMode;
          }
          await attendance.save();
        } else {
          // Create or update today's attendance record (prevents duplicates after biometric)
          attendance = await Attendance.findOneAndUpdate(
            { user: userId, date: attendanceDate },
            {
              $setOnInsert: { user: userId, date: attendanceDate },
              $set: {
                checkInTime: now.toDate(),
                checkInLocation: { latitude, longitude },
                status,
                ...(checkInMode && { checkInMode }),
              },
            },
            { upsert: true, new: true }
          );
        }
      }

      // If biometric+app created 2 records for same day, merge into a single record.
      // This fixes the current production issue immediately after app check-in.
      const dayDocs = await Attendance.find({
        user: userId,
        date: { $gte: attendanceDate, $lt: endOfDay },
      }).lean();

      if (dayDocs.length > 1) {
        const scoreDoc = (doc) =>
          (doc.checkInTime ? 100 : 0) +
          (doc.status ? 50 : 0) +
          (doc.checkOutTime ? 25 : 0) +
          (doc.biometricCheckIn ? 20 : 0) +
          (doc.biometricCheckOut ? 20 : 0) +
          (doc.checkInLocation ? 5 : 0) +
          (doc.checkOutLocation ? 5 : 0);

        const keep = dayDocs
          .slice()
          .sort((a, b) => {
            const sa = scoreDoc(a);
            const sb = scoreDoc(b);
            if (sb !== sa) return sb - sa;
            const ua = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const ub = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return ub - ua;
          })[0];

        const otherIds = dayDocs
          .filter((d) => String(d._id) !== String(keep._id))
          .map((d) => d._id);

        const biometricIns = dayDocs
          .map((d) => d.biometricCheckIn)
          .filter((v) => v !== null && v !== undefined)
          .map((v) => new Date(v).getTime());
        const biometricOuts = dayDocs
          .map((d) => d.biometricCheckOut)
          .filter((v) => v !== null && v !== undefined)
          .map((v) => new Date(v).getTime());

        const checkInTimes = dayDocs
          .map((d) => d.checkInTime)
          .filter((v) => v !== null && v !== undefined)
          .map((v) => new Date(v).getTime());
        const checkOutTimes = dayDocs
          .map((d) => d.checkOutTime)
          .filter((v) => v !== null && v !== undefined)
          .map((v) => new Date(v).getTime());

        const docsByRecent = dayDocs
          .slice()
          .sort((a, b) => {
            const ua = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const ub = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return ub - ua;
          });

        const merged = { ...keep };
        if (biometricIns.length) merged.biometricCheckIn = new Date(Math.min(...biometricIns));
        if (biometricOuts.length) merged.biometricCheckOut = new Date(Math.max(...biometricOuts));
        if (checkInTimes.length) merged.checkInTime = new Date(Math.min(...checkInTimes));
        if (checkOutTimes.length) merged.checkOutTime = new Date(Math.max(...checkOutTimes));
        // Ensure check-in essentials are present even if keep doc was biometric-only
        if (!merged.status) merged.status = status;
        if (!merged.checkInLocation) merged.checkInLocation = { latitude, longitude };
        if (!merged.checkInMode && checkInMode) merged.checkInMode = checkInMode;

        for (const d of docsByRecent) {
          if (!merged.checkInLocation && d.checkInLocation) merged.checkInLocation = d.checkInLocation;
          if (!merged.checkOutLocation && d.checkOutLocation) merged.checkOutLocation = d.checkOutLocation;
          if (!merged.checkInMode && d.checkInMode) merged.checkInMode = d.checkInMode;
          if (!merged.checkOutMode && d.checkOutMode) merged.checkOutMode = d.checkOutMode;
          if (!merged.leaveId && d.leaveId) merged.leaveId = d.leaveId;
          if (!merged.wfhId && d.wfhId) merged.wfhId = d.wfhId;
          if (!merged.regularization && d.regularization) merged.regularization = d.regularization;
          if (!merged.status && d.status) merged.status = d.status;
        }

        await Attendance.updateOne(
          { _id: keep._id },
          {
            $set: {
              checkInTime: merged.checkInTime,
              checkOutTime: merged.checkOutTime,
              biometricCheckIn: merged.biometricCheckIn,
              biometricCheckOut: merged.biometricCheckOut,
              checkInLocation: merged.checkInLocation,
              checkOutLocation: merged.checkOutLocation,
              status: merged.status,
              leaveId: merged.leaveId,
              wfhId: merged.wfhId,
              checkInMode: merged.checkInMode,
              checkOutMode: merged.checkOutMode,
              regularization: merged.regularization,
            },
          }
        );
        await Attendance.deleteMany({ _id: { $in: otherIds } });
        attendance = await Attendance.findById(keep._id);
      }
      if (alreadyCheckedInToday) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Already checked in today.',
        };
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


  async markCheckOut(userId, latitude, longitude, checkOutMode) {
    try {
      const now = moment().tz('Asia/Kolkata');
      const dayStartIST = now.clone().startOf('day');
      const attendanceDate = dayStartIST.clone().utc().toDate();
      const endOfDay = dayStartIST.clone().add(1, 'day').utc().toDate();

      const attendance = await Attendance.findOne({
        user: userId,
        date: { $gte: attendanceDate, $lt: endOfDay },
        checkOutTime: null,
        status: { $in: ['present', 'late_in', 'early_out', 'late_in_early_out'] },
      }).sort({ createdAt: -1 });

      if (!attendance) {
        return {
          status: 'error',
          statusCode: 400,
          message: 'Not checked in today.',
        };
      }

      attendance.checkOutTime = now.toDate();
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
        .populate('user', '_id firstName lastName employeeId workType hireDate shiftTime')
        .populate('leaveId')
        .populate('wfhId')
        .sort({ date: -1, checkInTime: -1 })
        .lean();

      const pendingLeaveQuery = {
        status: { $in: PENDING_WORKFLOW_STATUSES },
        isDeleted: { $ne: true },
        dates: dateQuery,
      };
      if (query.user) {
        pendingLeaveQuery.userId = query.user;
      }

      const pendingLeaves = await LeaveApplication.find(pendingLeaveQuery)
        .select('_id userId dates status')
        .lean();

      const pendingLeaveByUserDate = new Map();
      for (const leave of pendingLeaves) {
        for (const leaveDate of leave.dates || []) {
          const dateKey = moment(leaveDate).tz('Asia/Kolkata').format('YYYY-MM-DD');
          pendingLeaveByUserDate.set(`${leave.userId}_${dateKey}`, leave);
        }
      }

      const attendanceWithDisplayStatus = await Promise.all(
        attendance.map(async (record) => {
          const recordUserId = record.user?._id || record.user;
          const shiftTime = record.user?.shiftTime;

          if (!record.leaveId) {
            const dateKey = moment(record.date).tz('Asia/Kolkata').format('YYYY-MM-DD');
            const pendingLeave = pendingLeaveByUserDate.get(`${recordUserId}_${dateKey}`);
            if (pendingLeave) {
              record.leaveId = pendingLeave;
            }
          }

          let biometricBase = record.biometricStatus;

          if (LEAVE_ATTENDANCE_STATUSES.includes(record.status)) {
            if (record.biometricCheckIn) {
              biometricBase = await calculateBiometricStatus(
                recordUserId,
                record.biometricCheckIn,
                record.biometricCheckOut,
                record,
                shiftTime
              );
            } else {
              biometricBase = record.status;
            }
          } else if (record.biometricCheckIn) {
            biometricBase = await calculateBiometricStatus(
              recordUserId,
              record.biometricCheckIn,
              record.biometricCheckOut,
              record,
              shiftTime
            );
          }

          record.status = resolveAttendanceDisplayStatus(record, record.status);
          record.biometricStatus = resolveAttendanceDisplayStatus(record, biometricBase);

          return record;
        })
      );

      return {
        status: 'success',
        statusCode: 200,
        data: attendanceWithDisplayStatus,
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
        .select('checkInTime status checkInMode checkOutMode checkOutTime regularization.status')
        .lean();

      if (attendance) {
        // Determine if user is currently checked in
        const isCheckedIn = attendance.checkInTime && !attendance.checkOutTime;
        
        let displayStatus = resolveAttendanceDisplayStatus(attendance, attendance.status);
        
        // If user is checked in but status is early_out or late_in_early_out, 
        // they might be in the middle of their work day, so show appropriate status
        if (isCheckedIn && !attendance?.regularization?.status) {
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
                biometricStatus: attendanceStatus,
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
