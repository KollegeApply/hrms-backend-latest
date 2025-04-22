const Leave = require('../models/leaveModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const attendanceService = require('./attendanceService');

class leaveService {
  /**
   * Create a new Leave (HR/Admin only).
   * @param {object} leaveData - Validated leave data (includes reason, date, userId).
   * @returns {Promise<Leave>} - The created Leave document.
   * @throws {ApiError} - If a Leave already exists on the given date.
   */
  async createLeave(leaveData) {
    const existingLeave = await Leave.findOne({
      date: leaveData?.date,
      userId: leaveData?.userId,
      isDeleted: false,
    });

    if (existingLeave) {
      throw new ApiError(httpStatus.CONFLICT, 'A leave is already declared.');
    }
    const user = await User.findById(leaveData?.userId);
    const incomingLeaveType = leaveData?.leaveType;
    if (user?.status === 'onroll') {
      const totalValue = user?.leaves?.[incomingLeaveType];
      const usedValue = await Leave.find({
        isDeleted: false,
        userId: user?.id,
        // status: 'approved',
        leaveType: incomingLeaveType,
      });
      if (usedValue?.length >= totalValue) {
        console.log('Limit already exceeded');
        throw new ApiError(
          httpStatus.CONFLICT,
          'Already exhausted this leave quota'
        );
      }
    } else if (user?.status === 'probation') {
      const hireDate = new Date(user?.hireDate);
      const now = new Date();

      const yearsDiff = now?.getFullYear() - hireDate?.getFullYear();
      const monthsDiff = now?.getMonth() - hireDate?.getMonth();
      const totalMonths = yearsDiff * 12 + monthsDiff;
      if (totalMonths < 1) {
        console.log('Cannot apply for leave within 1 month of hiring.');
        throw new ApiError(
          httpStatus.CONFLICT,
          'Cannot apply for leave within 1 month of hiring.'
        );
      } else {
        const userLeaves = await Leave.find({
          isDeleted: false,
          userId: user?.id,
          // status: 'approved',
          leaveType: incomingLeaveType,
        });
        const numberOfLeavesTaken = userLeaves.length;
        if (totalMonths - 1 > numberOfLeavesTaken) {
          // return leaveData;
        } else {
          console.log('You have exhausted your leave limit');
          throw new ApiError(
            httpStatus.CONFLICT,
            'You have exhausted your leave limit'
          );
        }
      }
    }
    const newLeave = new Leave(leaveData);
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
    oldLeave.status = leaveData.status;
    if (leaveData.status === 'approved') {
      oldLeave.approvedBy = leaveData.edittorId;
      try {
        const markAttendance = await attendanceService.createAttendance(
          oldLeave.userId,
          leaveData.status,
          leaveData.reason,
          oldLeave.date,
          'leave'
        );
        console.log(markAttendance);
      } catch (err) {
        console.log(err);
      }
    } else if (leaveData.status === 'rejected') {
      oldLeave.rejectedBy = leaveData.edittorId;
    }

    // oldLeave.name = LeaveData.name;
    // oldLeave.date = LeaveData.date;
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
    result.isDeleted = true;
    result.status = 'revoked';
    return await result.save();
  }
}

module.exports = new leaveService();
