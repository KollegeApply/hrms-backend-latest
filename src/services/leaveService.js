const Leave = require('../models/leaveModel');
const Holiday = require('../models/holidayModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const attendanceService = require('./attendanceService');
const Attendance = require('../models/attendanceModel');
const { mongoose } = require('mongoose');

class leaveService {
  /**
   * Create a new Leave (HR/Admin only).
   * @param {object} leaveData - Validated leave data (includes reason, date, userId).
   * @returns {Promise<Leave>} - The created Leave document.
   * @throws {ApiError} - If a Leave already exists on the given date.
   */
  async createLeave(leaveData) {
    const { from, to, leaveReason, userId, leaveType } = leaveData;

    const startDate = new Date(from);
    const endDate = new Date(to);

    if (isNaN(startDate) || isNaN(endDate)) {
      throw new ApiError(400, 'Invalid leave date(s).');
    }

    // Generate full list of leave dates
    const generateDateRange = (start, end) => {
      const dates = [];
      const current = new Date(start);
      while (current <= end) {
        dates.push(new Date(current)); // push a copy
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };

    let leaveDates = generateDateRange(startDate, endDate);
    let validLeaveDates = [];

    // Loop through each date and apply checks
    for (let date of leaveDates) {
      const userObjId = new mongoose.Types.ObjectId(userId);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Check if the date is a holiday or a Sunday
      const holidayOnSameDate = await Holiday.findOne({
        date,
        isDeleted: false,
      });

      // If it's Sunday or a holiday, skip the date
      if (date.getDay() === 0 || holidayOnSameDate) {
        continue; // Skip Sunday or holiday
      }

      // Check if there is already an approved leave or WFH on the same day
      const existingApprovedLeave = await Leave.findOne({
        userId: userObjId,
        dates: { $in: [date] },
        status: { $in: ['approved'] },
        isDeleted: false,
      });

      if (existingApprovedLeave) {
        throw new ApiError(
          409,
          `Leave already approved on ${date.toDateString()}`
        );
      }

      // Check if attendance is already marked for this day
      const existingAttendance = await Attendance.findOne({
        user: userObjId,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['present', 'leave_applied', 'wfh_applied'] },
      });

      if (existingAttendance) {
        throw new ApiError(
          409,
          `Attendance already marked on ${date.toDateString()}`
        );
      }

      // Add valid date to the validLeaveDates array
      validLeaveDates.push(date);
    }

    // Check if validLeaveDates is empty
    if (validLeaveDates.length === 0) {
      throw new ApiError(
        400,
        'No leave can be applied for the selected dates due to holidays, Sundays, or existing attendance records.'
      );
    }

    // Validation: Ensure leave date is not already applied
    for (const date of validLeaveDates) {
      const userObjId = new mongoose.Types.ObjectId(userId);
      const existingLeave = await Leave.findOne({
        userId: userObjId,
        dates: { $in: [date] },
        status: { $nin: ['revoked', 'rejected'] },
        isDeleted: false,
      });

      if (existingLeave) {
        throw new ApiError(
          409,
          `Leave already applied on ${date.toDateString()}`
        );
      }
    }

    // Leave limit check remains the same
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, 'User not found.');

    if (user.status === 'onroll') {
      const totalAllowed = user?.leaves?.[leaveType];
      const usedLeaves = await Leave.find({
        isDeleted: false,
        userId,
        leaveType,
        status: 'approved',
      });

      // Flatten all leave dates into a single array to count the total number of leave days
      const usedLeaveDays = usedLeaves.reduce((acc, leave) => {
        // Spread all the dates from the leave document into the accumulator
        acc.push(...leave.dates);
        return acc;
      }, []);

      const usedLeaveCount = usedLeaveDays?.length;

      console.log('used leaves', usedLeaveCount);

      if (usedLeaveCount + leaveDates.length > totalAllowed) {
        throw new ApiError(409, 'Leave quota exceeded.');
      }
    }

    if (user.status === 'probation') {
      const hireDate = new Date(user?.hireDate);
      const now = new Date();
      const monthsDiff =
        (now.getFullYear() - hireDate.getFullYear()) * 12 +
        now.getMonth() -
        hireDate.getMonth();
      if (monthsDiff < 1) {
        throw new ApiError(
          409,
          'Cannot apply for leave within 1 month of hiring.'
        );
      }

      const pastLeaves = await Leave.find({
        isDeleted: false,
        userId,
        leaveType,
      });

      if (monthsDiff - 1 <= pastLeaves.length) {
        throw new ApiError(409, 'You have exhausted your leave limit.');
      }
    }

    // All validations passed, save the leave
    const newLeave = new Leave({
      userId,
      leaveReason,
      leaveType,
      dates: validLeaveDates, // Store the valid dates only (excluding Sundays/holidays)
    });

    return await newLeave.save();
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
        if (Array.isArray(oldLeave.dates) && oldLeave.dates.length > 0) {
          for (const singleDate of oldLeave.dates) {
            await attendanceService.createAttendance(
              oldLeave.userId,
              leaveData.status,
              oldLeave._id,
              singleDate,
              'leave'
            );
          }
        }
      } catch (err) {
        console.error('Error marking attendance:', err);
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
    const result = await Leave.findById(id);

    if (!result || result.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No leave on given date found');
    }

    if (result?.status === 'rejected') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'You cannot delete a rejected leave.'
      );
    }

    if (result.status === 'approved') {
      // Delete associated attendance records for those dates
      for (const date of result.dates) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        await Attendance.deleteOne({
          user: result.userId,
          date: { $gte: startOfDay, $lte: endOfDay },
          status: 'leave_applied',
          leaveId: result._id,
        });
      }
    }

    result.status = 'revoked';
    return await result.save();
  }
}

module.exports = new leaveService();
