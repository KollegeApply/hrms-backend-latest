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

    const userObjId = new mongoose.Types.ObjectId(userId);

    // Generate full list of leave dates
    const generateDateRange = (start, end) => {
      const dates = [];
      const current = new Date(start);
      while (current <= end) {
        const copy = new Date(current);
        copy.setHours(0, 0, 0, 0);
        dates.push(copy);
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };

    const leaveDates = generateDateRange(startDate, endDate);

    // Batch fetch holidays, attendance, and existing leaves
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
        date: {
          $gte: new Date(leaveDates[0]),
          $lte: new Date(leaveDates[leaveDates.length - 1]),
        },
        status: { $in: ['present', 'leave_applied', 'wfh_applied'] },
      }),
    ]);

    const holidayDates = new Set(holidays.map((h) => h.date.toDateString()));
    const existingLeaveDates = new Set(
      existingLeaves.flatMap((l) => l.dates.map((d) => d.toDateString()))
    );
    const attendanceDates = new Set(
      existingAttendance.map((a) => a.date.toDateString())
    );

    const rejectedReasons = [];

    const validLeaveDates = leaveDates.filter((date) => {
      const dateStr = date.toDateString();

      if (date.getDay() === 0) {
        rejectedReasons.push({ date: dateStr, reason: 'Sunday' });
        return false;
      }

      if (holidayDates.has(dateStr)) {
        rejectedReasons.push({ date: dateStr, reason: 'Holiday' });
        return false;
      }

      if (existingLeaveDates.has(dateStr)) {
        rejectedReasons.push({
          date: dateStr,
          reason: 'Leave already applied/approved',
        });
        return false;
      }

      if (attendanceDates.has(dateStr)) {
        rejectedReasons.push({
          date: dateStr,
          reason: 'Attendance already marked',
        });
        return false;
      }

      return true;
    });

    if (validLeaveDates.length === 0) {
      const reasonMessages = rejectedReasons
        .map((r) => `- ${r.date}: ${r.reason}`)
        .join('<br>');

      throw new ApiError(
        400,
        `No valid leave dates.<br>Reason:<br>${reasonMessages}`
      );
    }

    // Fetch user only once
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, 'User not found.');

    if (user.status === 'onroll') {
      const totalAllowed = user?.leaves?.[leaveType] || 0;
      const usedLeaves = await Leave.find({
        isDeleted: false,
        userId,
        leaveType,
        status: { $in: ['approved', 'pending'] },
      });

      const usedLeaveCount = usedLeaves.reduce((count, leave) => {
        return count + (leave.dates?.length || 0);
      }, 0);

      if (usedLeaveCount + validLeaveDates.length > totalAllowed) {
        throw new ApiError(409, 'Leave quota exceeded.');
      }
    }

    if (user.status === 'probation') {
      const hireDate = new Date(user.hireDate);
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

    // Save the new leave
    const newLeave = new Leave({
      userId,
      leaveReason,
      leaveType,
      dates: validLeaveDates,
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
