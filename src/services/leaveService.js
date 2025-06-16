const Leave = require('../models/leaveModel');
const Holiday = require('../models/holidayModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const attendanceService = require('./attendanceService');
const Attendance = require('../models/attendanceModel');
const { mongoose } = require('mongoose');
const { format } = require('date-fns');
const LeaveApplication = require('../models/leaveApplicationModel');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicy = require('../models/leavePolicyModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');

class leaveService {
  /**
   * Create a new Leave (HR/Admin only).
   * @param {object} leaveData - Validated leave data (includes reason, date, userId).
   * @returns {Promise<Leave>} - The created Leave document.
   * @throws {ApiError} - If a Leave already exists on the given date.
   */

  async createLeave(leaveData) {
    const { from, to, leaveReason, userId, leaveType } = leaveData;

    // 1. Validate Input Dates
    const startDate = new Date(from);
    const endDate = new Date(to);
    if (isNaN(startDate) || isNaN(endDate) || startDate > endDate) {
      throw new ApiError(400, 'Invalid leave date(s) provided.');
    }

    // 2. Generate Valid Leave Dates
    const { validLeaveDates, rejectedReasons } =
      await this.generateValidLeaveDates(userId, startDate, endDate);

    if (validLeaveDates.length === 0) {
      const reasonMessages = rejectedReasons
        .map((r) => `${r.date}: ${r.reason}`)
        .join('<br>');
      throw new ApiError(
        400,
        `No valid leave dates in the requested range.<br>${reasonMessages}`
      );
    }

    // 3. Find User
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    let autoRejected = false;
    let autoRejectReason = '';
    // 4. Leave Validation based on User Status
    if (user.status === 'probation') {
      const hireDate = new Date(user.hireDate);
      const probationValidation = await this.validateProbationLeave(
        hireDate,
        validLeaveDates,
        userId,
        leaveType
      );
      // console.log(probationValidation);

      if (!probationValidation.valid) {
        if (probationValidation.autoReject) {
          console.log(probationValidation.message);
          autoRejected = true;
          autoRejectReason = probationValidation.message;
        } else {
          throw new ApiError(409, probationValidation.message);
        }
      }
    } else if (user.status === 'onroll') {
      const leaveValidation = await this.validateOnRollLeave(
        user,
        leaveType,
        validLeaveDates
      );
      if (!leaveValidation.valid) {
        throw new ApiError(409, leaveValidation.message);
      }
    } else {
      throw new ApiError(400, `Invalid user status: ${user.status}.`);
    }

    // 5. Create and Save Leave Request
    const newLeave = new Leave({
      userId,
      leaveReason,
      leaveType,
      dates: validLeaveDates,
      status: autoRejected ? 'rejected' : 'pending',
      appliedOn: new Date(),
    });

    try {
      let savedLeave = await newLeave.save();

      // Convert to plain object so extra fields can be added
      const leaveResponse = savedLeave.toObject();
      leaveResponse.rejectionReason = autoRejected ? autoRejectReason : null;

      return leaveResponse;
    } catch (error) {
      console.error('Error saving leave request:', error);
      throw new ApiError(500, 'Failed to save leave request.');
    }
  }

  async generateValidLeaveDates(userId, startDate, endDate) {
    const userObjId = new mongoose.Types.ObjectId(userId);
    const leaveDates = [];
    let current = new Date(startDate);
    current.setHours(0, 0, 0, 0); // Normalize start date

    while (current <= endDate) {
      const dateCopy = new Date(current);
      dateCopy.setHours(0, 0, 0, 0);
      leaveDates.push(dateCopy);
      current.setDate(current.getDate() + 1);
    }

    if (leaveDates.length === 0) {
      return { validLeaveDates: [], rejectedReasons: [] }; // Handle empty range
    }

    const [holidays, existingLeaves, existingAttendance] = await Promise.all([
      Holiday.find({
        date: { $in: leaveDates },
        isDeleted: false,
      }),
      Leave.find({
        userId: userObjId,
        dates: { $in: leaveDates },
        status: { $in: ['approved', 'pending'] },
        isDeleted: false,
      }),
      Attendance.find({
        user: userObjId,
        date: { $gte: startDate, $lte: endDate },
        status: { $in: ['present', 'leave_applied', 'wfh_applied'] },
      }),
    ]);

    const holidayDates = new Set(holidays.map((h) => h.date.toISOString()));
    const existingLeaveDates = new Set(
      existingLeaves.flatMap((l) => l.dates.map((d) => d.toISOString()))
    );
    const attendanceDates = new Set(
      existingAttendance.map((a) => a.date.toISOString())
    );
    const rejectedReasons = [];
    const validLeaveDates = leaveDates.filter((date) => {
      const isoDate = date.toISOString();

      if (date.getDay() === 0) {
        rejectedReasons.push({
          date: format(new Date(isoDate), 'MMMM dd, yyyy'),
          reason: 'Sunday',
        });
        return false;
      }

      if (holidayDates.has(isoDate)) {
        rejectedReasons.push({
          date: format(new Date(isoDate), 'MMMM dd, yyyy'),
          reason: 'Holiday',
        });
        return false;
      }

      if (existingLeaveDates.has(isoDate)) {
        rejectedReasons.push({
          date: format(new Date(isoDate), 'MMMM dd, yyyy'),
          reason: 'Leave conflicts with existing leave.',
        });
        return false;
      }

      if (attendanceDates.has(isoDate)) {
        rejectedReasons.push({
          date: format(new Date(isoDate), 'MMMM dd, yyyy'),
          reason: 'Existing attendance record found.',
        });
        return false;
      }

      return true;
    });

    return { validLeaveDates, rejectedReasons };
  }

  // Refactored to be fully policy-driven. Legacy user.leaves logic removed.
  async validateProbationLeave(hireDate, requestedDates, userId, leaveType) {
    const now = new Date();

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const monthsDiff =
      (now.getFullYear() - hireDate.getFullYear()) * 12 +
      now.getMonth() -
      hireDate.getMonth();

    if (monthsDiff < 1) {
      return {
        valid: false,
        autoReject: true,
        message:
          'Leave auto-rejected during first month. If you have a genuine reason, please contact HR for further assistance.',
      };
    }

    // Validate dates using helper
    const startDate = new Date(
      Math.min(...requestedDates.map((d) => new Date(d)))
    );
    const endDate = new Date(
      Math.max(...requestedDates.map((d) => new Date(d)))
    );

    const { validLeaveDates, rejectedReasons } =
      await this.generateValidLeaveDates(userId, startDate, endDate);

    if (validLeaveDates.length !== requestedDates.length) {
      return {
        valid: false,
        message: 'Some requested leave dates are invalid.',
        details: rejectedReasons,
      };
    }

    // Restrict leave to current month only
    for (const date of validLeaveDates) {
      const d = new Date(date);
      if (
        d.getMonth() !== now.getMonth() ||
        d.getFullYear() !== now.getFullYear()
      ) {
        return {
          valid: false,
          message:
            'During probation, you can only apply for leave within the current calendar month.',
        };
      }
    }

    const requestedDays = requestedDates.length;

    if (leaveType === 'perMonth') {
      const earnedLeaves = Math.floor(monthsDiff * 1); // 1 leave per completed month
      const usedPerMonthLeaves = await this.getUsedLeaveDays(
        userId,
        'perMonth'
      );
      const perMonthRemaining = earnedLeaves - usedPerMonthLeaves;

      if (validLeaveDates.length > perMonthRemaining) {
        return {
          valid: false,
          message: `You have only ${perMonthRemaining} per month leave days available.`,
        };
      }
    }
    if (leaveType === 'carryForwardLeave') {
      const carryForwardTotal = user.leaves?.carryForwardLeave?.total || 0;
      const carryForwardUsed = await this.getProbUsedLeaveDays(
        user._id,
        'carryForwardLeave'
      );
      const remaining = carryForwardTotal - carryForwardUsed;

      if (remaining <= 0 || requestedDays > remaining) {
        return {
          valid: false,
          message: `You have only ${remaining} carry forward leave day(s) remaining.`,
        };
      }
    }

    return { valid: true, validDates: validLeaveDates };
  }

  async getProbUsedLeaveDays(userId, leaveType) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const hireDate = new Date(user.hireDate);
    const now = new Date();

    // For probation: consider all leaves from hireDate until now
    const leaves = await Leave.find({
      userId,
      leaveType,
      status: { $in: ['approved', 'pending'] },
      dates: { $elemMatch: { $gte: hireDate, $lte: now } },
      isDeleted: false,
    });

    let usedDays = 0;
    for (const leave of leaves) {
      for (const date of leave.dates) {
        const d = new Date(date);
        if (d >= hireDate && d <= now) {
          usedDays++;
        }
      }
    }

    return usedDays;
  }

  async getUsedLeaveDays(userId, leaveType, quarter) {
    const match = {
      userId: new mongoose.Types.ObjectId(userId),
      leaveType,
      status: { $in: ['approved', 'pending'] }, // Include pending leaves
      isDeleted: false,
    };

    if (quarter) {
      const year = new Date().getFullYear();
      let startDate;
      let endDate;

      switch (quarter) {
        case 1:
          startDate = new Date(year, 0, 1); // 1st Quarter: Jan 1 - Mar 31
          endDate = new Date(year, 2, 31, 23, 59, 59, 999);
          break;
        case 2:
          startDate = new Date(year, 3, 1); // 2nd Quarter: Apr 1 - Jun 30
          endDate = new Date(year, 5, 30, 23, 59, 59, 999);
          break;
        case 3:
          startDate = new Date(year, 6, 1); // 3rd Quarter: Jul 1 - Sep 30
          endDate = new Date(year, 8, 30, 23, 59, 59, 999);
          break;
        case 4:
          startDate = new Date(year, 9, 1); // 4th Quarter: Oct 1 - Dec 31
          endDate = new Date(year, 11, 31, 23, 59, 59, 999);
          break;
        default:
          // Handle invalid quarter (optional, but good practice)
          console.error(`Invalid quarter: ${quarter}`);
          return 0;
      }

      match.dates = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const result = await Leave.aggregate([
      { $match: match },
      { $unwind: '$dates' },
      { $count: 'total' },
    ]);
    return result[0]?.total || 0;
  }

  async validateOnRollLeave(user, leaveType, requestedDates) {
    const leaveConfig = user.leaves[leaveType];
    if (!leaveConfig) {
      return {
        valid: false,
        message: `Leave type "${leaveType}" is not configured for this user.`,
      };
    }

    if (leaveType === 'carryForwardLeave') {
      const usedLeaves = await this.getUsedLeaveDays(
        user._id,
        'carryForwardLeave'
      );
      if (usedLeaves + requestedDates.length > leaveConfig.total) {
        return {
          valid: false,
          message: `Exceeds available carry forward leaves (${leaveConfig.total} days remaining).`,
        };
      }
      return { valid: true };
    }

    if (
      leaveConfig.quarters &&
      ['annualLeave', 'casualSickLeave'].includes(leaveType)
    ) {
      const getQuarter = (date) => Math.ceil((date.getMonth() + 1) / 3);
      const requestedLeaveByQuarter = requestedDates.reduce((acc, date) => {
        const quarter = getQuarter(new Date(date));
        acc[quarter] = (acc[quarter] || 0) + 1;
        return acc;
      }, {});

      for (const [quarterStr, requestedDays] of Object.entries(
        requestedLeaveByQuarter
      )) {
        const quarter = parseInt(quarterStr, 10); // Parse quarter string to number
        const quarterAllocation = leaveConfig.quarters.find(
          (q) => q.quarter === quarter
        );
        if (!quarterAllocation) {
          return {
            valid: false,
            message: `No leave allocation found for Quarter ${quarter}.`,
          };
        }

        const usedInQuarter = await this.getUsedLeaveDays(
          user._id,
          leaveType,
          quarter
        );
        const availableInQuarter = quarterAllocation.total - usedInQuarter;
        console.log(
          quarterAllocation,
          '-',
          usedInQuarter,
          'quarter:',
          quarter,
          'leaveType:',
          leaveType
        );

        if (requestedDays > availableInQuarter) {
          return {
            valid: false,
            message: `Exceeds Q${quarter} ${leaveType.replace(/([A-Z])/g, ' $1').trim()} allocation (${availableInQuarter} days remaining).`,
          };
        }
      }
      return { valid: true };
    }

    // Handle non-quarterly leaves (marriage, bereavement, birthday, etc.)
    if (leaveConfig.total !== undefined) {
      const totalUsed = await this.getUsedLeaveDays(user._id, leaveType);
      if (totalUsed + requestedDates.length > leaveConfig.total) {
        return {
          valid: false,
          message: `Exceeds total ${leaveType.replace(/([A-Z])/g, ' $1').trim()} allocation (${
            leaveConfig.total - totalUsed
          } days remaining).`,
        };
      }
      return { valid: true };
    }

    // If leave type doesn't have quarters or a total, consider it invalid
    return {
      valid: false,
      message: `Leave type "${leaveType}" has an invalid configuration.`,
    };
  }

  /**
   * Get all Leave (excluding soft-deleted ones).
   * @returns {Promise<Leave[]>} - List of all non-deleted Leaves, sorted by date.
   */
  async getAllLeave() {
    const leaves = await LeaveApplication.find({ isDeleted: { $ne: true } })
      .sort({
        createdAt: -1,
      })
      .populate('userId')
      .populate({
        path: 'leaveTypeId',
        select: 'name',
      });

    if (!leaves || leaves?.length === 0) {
      return leaves;
    }

    return leaves;
  }

  /**
   * Get a Leave by UserID.
   * @param {Object} params - Object containing the leave ID.
   * @param {String} params.id - MongoDB ObjectId.
   * @returns {Promise<Leave>} - The found leave.
   * @throws {ApiError} - If no leave is found with the given ID.
   */
  async getLeaveById({ id }) {
    const result = await LeaveApplication.find({ userId: id })
      .sort({ createdAt: -1 })
      .populate('userId');
    if (!result || result.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No Leave for the given user');
    }
    return result;
  }

  /**
   * Update a Leave by its ID
   * @param {String} id - MongoDB ObjectId
   * @param {Object} updateData - Validated update data
   * @returns {Promise<Leave|null>}
   */
  async updateLeave(leaveData) {
    const oldLeave = await LeaveApplication.findOne({
      _id: leaveData.leaveId,
      isDeleted: false,
    }).populate('leaveTypeId'); // To access code if needed later

    if (!oldLeave) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
    }

    // Allow status change from rejected to approved
    if (oldLeave.status === 'approved') {
      throw new ApiError(409, 'Cannot modify approved leaves');
    }

    // Allow only 'pending' or 'rejected' to be updated
    if (!['pending', 'rejected'].includes(oldLeave.status)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Leave status cannot be modified in its current state.'
      );
    }

    oldLeave.status = leaveData.status;

    if (leaveData.status === 'approved') {
      oldLeave.approvedBy = leaveData.edittorId;

      try {
        const leaveRecords = Array.isArray(leaveData.leaves)
          ? leaveData.leaves
          : [oldLeave];

        await Promise.all(
          leaveRecords.map(async (leave) => {
            console.log(leave);
            await attendanceService.bulkCreateOrUpdateLeaveAttendance(
              leave.userId,
              leave._id,
              leave.dates
            );

            const empBalance = await EmployeeLeaveBalance.findOne({
              userId: leave.userId,
              leaveTypeId: leave.leaveTypeId._id,
            });
            console.log(empBalance, leave.leaveTypeId._id);

            if (empBalance) {
              const daysUsed = leave.dates?.length || leave.totalDays || 0;

              empBalance.used = (empBalance.used || 0) + daysUsed;

              empBalance.total =
                (empBalance.accrued || 0) + (empBalance.carryForwarded || 0);

                console.log(empBalance);
              await empBalance.save();
            }
          })
        );
      } catch (err) {
        console.error('Error updating attendance or leave balance total:', err);
      }
    } else if (leaveData.status === 'rejected') {
      oldLeave.rejectedBy = leaveData.edittorId;
    }

    return await oldLeave.save();
  }

  async getLeaveTl({ id }) {
    const leadUsers = await User.find(
      {
        $or: [{ teamLeadId: id }, { subTeamLeadId: id }],
      },
      'id'
    );

    const userIds = leadUsers.map((user) => user._id.toString());
    userIds.push(id); // includes itself

    const leaveEntries = await Leave.find({
      userId: { $in: userIds },
    }).populate('userId');

    return leaveEntries;
  }

  /**
   * Soft delete a Leave Application by its ID.
   * @param {Object} params - Object containing the leave ID and user ID.
   * @param {string} params.id - The MongoDB ObjectId of the leave to delete.
   * @param {string} params.userId - The ID of the user requesting deletion.
   * @returns {Promise<LeaveApplication>} - The updated leave application with isDeleted set to true.
   * @throws {ApiError} - If the leave doesn't exist, is already deleted, or user doesn't have permission.
   */
  async deleteLeave({ id, userId }) {
    try {
      // Get the leave application with populated fields
      const leaveApplication = await LeaveApplication.findById(id)
        .populate('leaveTypeId')
        .populate('userId', 'name email');

      if (!leaveApplication) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Leave application not found');
      }

      if (leaveApplication.isDeleted) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Leave application is already deleted'
        );
      }
      console.log(leaveApplication.userId._id.toString(), userId);

      // Check if user has permission to delete
      if (leaveApplication.userId._id.toString() !== userId) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'You do not have permission to delete this leave application'
        );
      }

      // Check if leave can be deleted (only pending leaves can be deleted)
      if (leaveApplication.status !== 'pending') {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Only pending leave applications can be deleted'
        );
      }

      // Soft delete the leave application
      leaveApplication.status = 'revoked';
      leaveApplication.isDeleted = true;
      await leaveApplication.save();

      return leaveApplication;
    } catch (err) {
      console.error('Error deleting leave application:', err);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        err.message || 'Failed to delete leave application'
      );
    }
  }

  async validateLeaveDates(userId, startDate, endDate, leaveTypeId) {
    try {
      // ✅ 1. Helper to get UTC date at 18:30 (IST midnight)
      const toISTMidnightUTC = (date) => {
        const d = new Date(date);
        d.setUTCHours(18, 30, 0, 0);
        return new Date(d);
      };

      const today = toISTMidnightUTC(new Date());

      const formatDateOnly = (date) => {
        const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
        return istDate.toISOString().split('T')[0];
      };

      // ✅ 2. Convert and Validate Range
      const currentDate = toISTMidnightUTC(startDate);
      const lastDate = toISTMidnightUTC(endDate);

      if (!currentDate || !lastDate || currentDate > lastDate) {
        return {
          isValid: false,
          reason: 'Invalid date range provided',
          rejectedReasons: ['Start date or end date is invalid'],
        };
      }

      // ✅ 3. Fetch User, Leave Type, and Policy Mapping
      const employee = await User.findById(userId);
      if (!employee || !employee.leavePolicyId) {
        return { isValid: false, reason: 'User or leave policy not found' };
      }

      const leaveType = await LeaveType.findById(leaveTypeId);
      if (!leaveType) {
        return { isValid: false, reason: 'Invalid leave type' };
      }

      const mapping = await LeavePolicyMapping.findOne({
        leavePolicyId: employee.leavePolicyId,
        leaveTypeId: leaveType._id,
      });

      if (!mapping) {
        return {
          isValid: false,
          reason: 'Leave type not configured in policy',
        };
      }

      // ✅ 4. Birthday Leave Rule
      if (leaveType.code === 'BIRTHDAY') {
        const birthDate = new Date(employee.dateOfBirth);
        if (
          currentDate.getDate() !== birthDate.getDate() ||
          currentDate.getMonth() !== birthDate.getMonth()
        ) {
          return {
            isValid: false,
            reason: 'Birthday leave can only be taken on your birth date',
          };
        }
      }

      // ✅ 5. Marriage Leave Rule
      if (leaveType.code === 'MARRIAGE') {
        const usedMarriage = await LeaveApplication.findOne({
          userId,
          leaveTypeId,
          status: { $in: ['approved', 'pending'] },
        });

        const requestedDays =
          Math.ceil((lastDate - currentDate) / (1000 * 60 * 60 * 24)) + 1;

        const quota = mapping?.quota ?? 5;

        if (usedMarriage) {
          return {
            isValid: false,
            reason: 'Marriage leave can only be taken once',
          };
        }

        if (requestedDays > quota) {
          return {
            isValid: false,
            reason: 'Marriage leave cannot exceed 5 days',
          };
        }
      }

      // ✅ 6. Leave Balance
      const currentYear = today.getFullYear();
      const balance = await EmployeeLeaveBalance.findOne({
        userId,
        leaveTypeId: leaveType._id,
        year: currentYear,
      });

      // Calculate pending leaves for this type
      const pendingLeaves = await LeaveApplication.find({
        userId,
        leaveTypeId: leaveType._id,
        status: 'pending',
      });

      let totalPendingDays = 0;
      pendingLeaves.forEach((leave) => {
        totalPendingDays += leave.totalDays;
      });

      const { accrued = 0, used = 0, carryForwarded = 0 } = balance || {};
      const totalAvailable =
        leaveType.code === 'UNPAID'
          ? Infinity
          : accrued + carryForwarded - (used + totalPendingDays);

      // ✅ 7. Month Start & End for Accrual
      const currentMonthStart = toISTMidnightUTC(
        new Date(today.getFullYear(), today.getMonth(), 1)
      );
      const currentMonthEnd = toISTMidnightUTC(
        new Date(today.getFullYear(), today.getMonth() + 1, 0)
      );

      // ✅ 8. Fetch Existing Leaves & Attendance
      const [existingLeaves, existingAttendance] = await Promise.all([
        LeaveApplication.find({
          userId,
          status: { $in: ['approved', 'pending'] },
          dates: { $elemMatch: { $gte: startDate, $lte: endDate } },
        }),
        Attendance.find({
          userId,
          date: { $gte: currentDate, $lte: lastDate },
        }),
      ]);

      const existingLeaveDates = new Set();
      const existingAttendanceDates = new Set();

      existingLeaves.forEach((leave) => {
        leave.dates.forEach((date) => {
          existingLeaveDates.add(formatDateOnly(date));
        });
      });

      existingAttendance.forEach((att) => {
        existingAttendanceDates.add(formatDateOnly(att.date));
      });

      // ✅ 9. Day-by-Day Date Validation
      const validDates = [];
      const reasonMap = {};

      const addReason = (reason, dateStr) => {
        if (!reasonMap[reason]) {
          reasonMap[reason] = [];
        }
        reasonMap[reason].push(dateStr);
      };
      let pointer = new Date(currentDate);

      // Allow future dates for annual and casual sick leaves
      // const allowFutureDates = ['ANNUAL', 'CASUAL', 'PROBATION'].includes(
      //   leaveType.code
      // );

      while (pointer <= lastDate) {
        const dateStr = formatDateOnly(pointer);
        const dateObj = toISTMidnightUTC(pointer);
        const istDay = new Date(
          dateObj.getTime() + 5.5 * 60 * 60 * 1000
        ).getDay();

        if (istDay === 0) {
          // addReason('Sunday', dateStr);
        } else if (existingLeaveDates.has(dateStr)) {
          // addReason('Already applied leave', dateStr);
        } else if (existingAttendanceDates.has(dateStr)) {
          // addReason('Attendance already marked', dateStr);
        } else {
          const holiday = await Holiday.findOne({
            date: {
              $gte: dateObj,
              $lt: new Date(dateObj.getTime() + 1000 * 60 * 60 * 24),
            },
          });

          if (holiday) {
            // addReason(`Holiday (${holiday.name})`, dateStr);
          } else {
            validDates.push(new Date(dateObj));
          }
        }

        pointer.setDate(pointer.getDate() + 1);
      }

      // ✅ 10. Bereavement Leave Rule
      if (leaveType.code === 'BEREAVEMENT') {
        const usedBereavement = await this.getUsedBereavementDays(
          userId,
          currentYear
        );
        const totalRequested = validDates.length;
        const quota = mapping?.quota ?? 3;

        if (usedBereavement >= quota) {
          return {
            isValid: false,
            reason:
              'Annual bereavement leave quota (3 days) has been exhausted',
          };
        }

        if (usedBereavement + totalRequested > 3) {
          return {
            isValid: false,
            reason: `Only ${3 - usedBereavement} bereavement days remaining this year`,
          };
        }
      }

      // ✅ 11. Probation Check

      const hireDate = new Date(employee.hireDate);
      const isInFirstMonth =
        currentDate.getFullYear() === hireDate.getFullYear() &&
        currentDate.getMonth() === hireDate.getMonth();

      const isProbationLeave = leaveType.code === 'PROBATION';

      if (isInFirstMonth && isProbationLeave) {
        const availableAfterRequest = totalAvailable - validDates.length;

        if (availableAfterRequest < 0) {
          return {
            isValid: false,
            reason: `Insufficient leave balance. Available: ${totalAvailable.toFixed(
              2
            )}, Requested: ${validDates.length}`,
            rejectedReasons: [
              `Insufficient leave balance. Available: ${totalAvailable.toFixed(
                2
              )}, Requested: ${validDates.length}`,
            ],
            dates: validDates,
          };
        }

        return {
          isValid: true,
          autoReject: true,
          rejectedReasons: [
            'Auto-rejected: Probation leave not allowed in first month. If you have a genuine reason, contact HR.',
          ],
          dates: validDates,
        };
      }

      // ✅ 12. Final Return
      const totalRequestedDays = validDates.length;
      const groupedRejectedReasons = Object.entries(reasonMap).map(
        ([reason, dates]) => `${reason}: ${dates.join(', ')}`
      );

      if (totalRequestedDays === 0) {
        return {
          isValid: false,
          reason: 'No valid leave dates found',
          rejectedReasons: groupedRejectedReasons,
        };
      }

      // For unpaid leave, skip balance check
      if (leaveType.code === 'UNPAID') {
        return {
          isValid: true,
          dates: validDates,
          rejectedReasons: groupedRejectedReasons,
        };
      }

      // Include current request in balance check
      const availableAfterRequest = totalAvailable - totalRequestedDays;

      if (availableAfterRequest < 0) {
        return {
          isValid: false,
          reason: `Insufficient leave balance. Available: ${totalAvailable.toFixed(2)}, Requested: ${totalRequestedDays}`,
          rejectedReasons: groupedRejectedReasons,
        };
      }

      return {
        isValid: true,
        dates: validDates,
        rejectedReasons: groupedRejectedReasons,
      };
    } catch (error) {
      console.error('Error in validateLeaveDates:', error);
      return {
        isValid: false,
        reason: error.message || 'Error validating leave dates',
      };
    }
  }

  async getUsedBereavementDays(userId, year) {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    const bereavementLeaves = await LeaveApplication.find({
      userId,
      leaveTypeId: await LeaveType.findOne({ code: 'BEREAVEMENT' }).select(
        '_id'
      ),
      status: ['approved', 'pending'],
      dates: {
        $gte: startOfYear,
        $lte: endOfYear,
      },
    });

    return bereavementLeaves.reduce(
      (total, leave) => total + leave.totalDays,
      0
    );
  }

  async getUsedProbationLeaves(userId) {
    const probationLeaves = await LeaveApplication.find({
      userId,
      leaveTypeId: await LeaveType.findOne({ code: 'PROBATION' }).select('_id'),
      status: { $in: ['approved', 'pending'] },
    });

    return probationLeaves.reduce((total, leave) => total + leave.totalDays, 0);
  }

  async calculateMonthlyLeaveBalance(user, leaveType) {
    const mapping = await LeavePolicyMapping.findOne({
      leavePolicyId: user.leavePolicyId,
      leaveTypeId: leaveType,
    });

    if (!mapping) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Leave type not allowed for this policy'
      );
    }

    // If no accrual type is specified or it's 'none', return the quota directly
    if (!mapping.accrualType || mapping.accrualType === 'none') {
      return mapping.quota;
    }

    // Validate accrualPerMonth
    if (!mapping.accrualPerMonth || mapping.accrualPerMonth < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid accrual rate in leave policy'
      );
    }

    // Get user's joining date
    const joiningDate = new Date(user.joiningDate);
    const currentDate = new Date();

    // Calculate months between joining date and current date
    const monthsDiff =
      (currentDate.getFullYear() - joiningDate.getFullYear()) * 12 +
      (currentDate.getMonth() - joiningDate.getMonth());

    // For annual leave policy (1.33 leaves per month)
    if (mapping.accrualType === 'yearly') {
      // Calculate total accrued leaves (1.33 per month)
      const accruedLeaves = (monthsDiff * 1.33).toFixed(2);

      // Get used leaves for current year
      const year = new Date().getFullYear();
      const usedLeaves = await LeaveApplication.aggregate([
        {
          $match: {
            userId: user._id,
            leaveTypeId: leaveType,
            status: { $in: ['approved', 'pending'] },
            isDeleted: false,
            dates: {
              $gte: new Date(year, 0, 1),
              $lt: new Date(year + 1, 0, 1),
            },
          },
        },
        {
          $project: {
            totalDays: 1,
          },
        },
        {
          $group: {
            _id: null,
            totalUsed: { $sum: '$totalDays' },
          },
        },
      ]);

      const totalUsed = usedLeaves.length > 0 ? usedLeaves[0].totalUsed : 0;

      // Calculate available balance
      const availableBalance = Math.max(
        0,
        parseFloat(accruedLeaves) - totalUsed
      );

      // Round to 2 decimal places
      return Math.round(availableBalance * 100) / 100;
    }

    // For monthly accrual
    if (mapping.accrualType === 'monthly') {
      const accruedLeaves = monthsDiff * mapping.accrualPerMonth;
      const usedLeaves = await LeaveApplication.aggregate([
        {
          $match: {
            userId: user._id,
            leaveTypeId: leaveType,
            status: { $in: ['approved', 'pending'] },
            isDeleted: false,
          },
        },
        {
          $project: {
            totalDays: 1,
          },
        },
        {
          $group: {
            _id: null,
            totalUsed: { $sum: '$totalDays' },
          },
        },
      ]);

      const totalUsed = usedLeaves.length > 0 ? usedLeaves[0].totalUsed : 0;
      return Math.max(0, accruedLeaves - totalUsed);
    }

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Invalid accrual type in leave policy'
    );
  }

  async validateLeaveQuota(user, leaveType, requestedDates) {
    const mapping = await LeavePolicyMapping.findOne({
      leavePolicyId: user.leavePolicyId,
      leaveTypeId: leaveType,
    });

    if (!mapping) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Leave type not allowed for this policy'
      );
    }

    // Get all leaves for the current year
    const year = new Date().getFullYear();
    const usedLeaves = await LeaveApplication.aggregate([
      {
        $match: {
          userId: user._id,
          leaveTypeId: leaveType,
          status: { $in: ['approved', 'pending'] },
          isDeleted: false,
          dates: {
            $gte: new Date(year, 0, 1),
            $lt: new Date(year + 1, 0, 1),
          },
        },
      },
      {
        $project: {
          totalDays: 1,
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$totalDays' },
        },
      },
    ]);

    const totalUsed = usedLeaves.length > 0 ? usedLeaves[0].totalUsed : 0;
    const requestedDays = requestedDates.length;

    // Check if the request would exceed the yearly quota
    if (totalUsed + requestedDays > mapping.quota) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This request would exceed your yearly quota. Used: ${totalUsed}, Quota: ${mapping.quota}, Requested: ${requestedDays}`
      );
    }

    return true;
  }

  async applyForLeave(userId, leaveData) {
    try {
      // Check if leaveData is provided
      if (!leaveData) {
        return {
          status: false,
          message: 'Leave data is required',
        };
      }

      // Extract data from request body
      const {
        from: startDate,
        to: endDate,
        leaveType,
        leaveReason: reason,
      } = leaveData;

      // Validate dates
      if (!startDate || !endDate) {
        return {
          status: false,
          message: 'Start date and end date are required',
        };
      }

      // Validate leave type
      if (!leaveType) {
        return {
          status: false,
          message: 'Leave type is required',
        };
      }

      // Get leave type ID
      const leaveTypeDoc = await LeaveType.findOne({ _id: leaveType });
      if (!leaveTypeDoc) {
        return {
          status: false,
          message: 'Invalid leave type',
        };
      }

      // Validate dates
      const validationResult = await this.validateLeaveDates(
        userId,
        startDate,
        endDate,
        leaveType
      );

      if (!validationResult.isValid) {
        return {
          status: false,
          message: validationResult.reason,
          rejectedReasons: validationResult.rejectedReasons || [],
        };
      }

      if (validationResult.autoReject) {
        const autoRejectedLeave = new LeaveApplication({
          userId,
          leaveTypeId: leaveTypeDoc._id,
          leaveReason: reason,
          dates: validationResult.dates,
          totalDays: 0,
          status: 'auto-rejected',
          rejectionReason: validationResult.autoRejectReason,
          appliedOn: new Date(),
        });

        await autoRejectedLeave.save();

        return {
          status: false,
          message: validationResult.autoRejectReason,
          rejectedReasons: validationResult.rejectedReasons,
          data: autoRejectedLeave,
        };
      }

      // Ensure we have valid dates
      if (
        !validationResult.dates ||
        !Array.isArray(validationResult.dates) ||
        validationResult.dates.length === 0
      ) {
        return {
          status: false,
          message: 'No valid dates found for leave application',
          rejectedReasons: validationResult.rejectedReasons || [],
        };
      }

      // Create leave application
      const leaveApplication = new LeaveApplication({
        userId,
        leaveTypeId: leaveTypeDoc._id,
        leaveReason: reason,
        dates: validationResult.dates,
        totalDays: validationResult.dates.length,
        status: 'pending',
        appliedAt: new Date(),
      });

      await leaveApplication.save();

      return {
        status: true,
        message: 'Leave application submitted successfully',
        data: leaveApplication,
      };
    } catch (error) {
      console.error('Error in applyForLeave:', error);
      return {
        status: false,
        message: error.message || 'Error applying for leave',
      };
    }
  }

  async checkLeaveActionPermission(currentUser, leave) {
    // Admin/HR can take action on any leave
    if (currentUser.role === 'admin' || currentUser.role === 'hr') {
      return true;
    }

    // Team leads can take action on their team members' leaves
    if (currentUser.role === 'teamlead' || currentUser.role === 'subteamlead') {
      const teamMember = await User.findById(leave.userId);
      return (
        teamMember &&
        (teamMember.teamLeadId?.toString() === currentUser.id ||
          teamMember.subTeamLeadId?.toString() === currentUser.id)
      );
    }

    // Regular users can only revoke their own leaves
    return currentUser.id === leave.userId.toString();
  }
}

module.exports = new leaveService();
