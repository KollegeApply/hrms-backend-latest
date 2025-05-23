const Leave = require('../models/leaveModel');
const Holiday = require('../models/holidayModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const attendanceService = require('./attendanceService');
const Attendance = require('../models/attendanceModel');
const { mongoose } = require('mongoose');
const { format } = require('date-fns');

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

    // 4. Leave Validation based on User Status
    if (user.status === 'probation') {
      const hireDate = new Date(user.hireDate);
      const probationValidation = await this.validateProbationLeave(
        hireDate,
        validLeaveDates,
        userId,
        leaveType
      );

      if (!probationValidation.valid) {
        throw new ApiError(409, probationValidation.message);
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
      status: 'pending', // Initial status
      appliedOn: new Date(),
    });

    try {
      const savedLeave = await newLeave.save();
      // Optionally, trigger notifications or other post-leave-request logic here
      return savedLeave;
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
        message: 'Cannot apply for leave within the first month of employment.',
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
    const leaves = await Leave.find({ isDeleted: { $ne: true } })
      .sort({
        createdAt: -1,
      })
      .populate('userId');

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
    const result = await Leave.find({ userId: id })
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
    const oldLeave = await Leave.findOne({
      _id: leaveData.leaveId,
      isDeleted: false,
    });

    if (!oldLeave) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
    }

    if (oldLeave.status !== 'pending') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Seems like status of leave has already been changed. Refresh page to see changes.'
      );
    }

    oldLeave.status = leaveData.status;

    if (leaveData.status === 'approved') {
      oldLeave.approvedBy = leaveData.edittorId;

      try {
        // Check if we have multiple leaves to process
        if (Array.isArray(oldLeave.dates) && oldLeave.dates.length > 0) {
          // This will handle multiple leave records
          const leaveRecords = Array.isArray(leaveData.leaves)
            ? leaveData.leaves
            : [oldLeave];

          // Use Promise.all to handle multiple records in parallel
          await Promise.all(
            leaveRecords.map(async (leave) => {
              await attendanceService.bulkCreateOrUpdateLeaveAttendance(
                leave.userId,
                leave._id,
                leave.dates
              );
            })
          );
        }
      } catch (err) {
        console.error('Error marking bulk attendance:', err);
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
   * Soft delete a Leave by its ID.
   * @param {Object} params - Object containing the leave ID.
   * @param {string} params.id - The MongoDB ObjectId of the leave to delete.
   * @returns {Promise<Leave>} - The updated leave with isDeleted set to true.
   * @throws {ApiError} - If the leave doesn't exist or is already deleted.
   */
  async deleteLeave({ id }) {
    try {
      const result = await Leave.findById(id);

      if (!result || result.isDeleted) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          'Leave not found or already deleted'
        );
      }

      if (result.status === 'rejected') {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Cannot delete a rejected leave'
        );
      }

      // Only delete attendance records if leave is approved
      if (result.status === 'approved') {
        // Create an array of attendance deletion operations for the given dates
        const attendanceOps = result.dates.map((date) => {
          const startOfDay = new Date(date);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(date);
          endOfDay.setHours(23, 59, 59, 999);

          return {
            deleteOne: {
              filter: {
                user: result.userId,
                date: { $gte: startOfDay, $lte: endOfDay },
                status: 'leave_applied',
                leaveId: result._id,
              },
            },
          };
        });

        // Perform bulk deletion of attendance records
        await Attendance.bulkWrite(attendanceOps);
      }

      // Update the leave status to 'revoked'
      result.status = 'revoked';
      return await result.save();
    } catch (err) {
      console.error('Error deleting leave:', err);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Failed to delete leave'
      );
    }
  }
}

module.exports = new leaveService();
