const User = require('../models/userModel');
const WFH = require('../models/wfhModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const attendanceService = require('./attendanceService');
const Holiday = require('../models/holidayModel');
const Attendance = require('../models/attendanceModel');

class wfhService {
  /**
   * Create a new wfh (HR/Admin only).
   * @param {object} wfhData - Validated wfh data (includes reason, date, userId).
   * @returns {Promise<WFH>} - The created WFH document.
   * @throws {ApiError} - If a WFH already exists on the given date.
   */
  async createWfh(wfhData) {
    const existingWfh = await WFH.findOne({
      date: wfhData?.date,
      userId: wfhData?.userId,
      // wfhReason: wfhData.wfhReason,
      isDeleted: false,
    });

    if (existingWfh) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'A wfh on the same date is already declared.'
      );
    }
    const holidayOnSameDate = await Holiday.findOne({
      date: wfhData?.date,
      isDeleted: false,
    });
    //if its already a holiday or a sunday
    if (holidayOnSameDate || wfhData?.date?.getDay() === 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `It's already a holiday on this date`
      );
    }

    // Convert to day boundaries
    const leaveDate = new Date(wfhData?.date);
    leaveDate.setHours(0, 0, 0, 0);

    const endOfLeaveDate = new Date(wfhData?.date);
    endOfLeaveDate.setHours(23, 59, 59, 999);

    // Block if attendance already exists for this date
    const existingAttendance = await Attendance.findOne({
      user: wfhData?.userId,
      date: { $gte: leaveDate, $lte: endOfLeaveDate },
      status: { $in: ['present', 'leave_applied', 'wfh_applied'] },
    });

    if (existingAttendance) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Attendance already marked (Check-In/Leave/WFH) for this date.'
      );
    }

    const newWfh = new WFH(wfhData);
    return await newWfh.save();
  }

  /**
   * Get all WFH (excluding soft-deleted ones).
   * @returns {Promise<WFH[]>} - List of all non-deleted wfhs, sorted by date.
   */
  async getAllWfh() {
    const wfhs = await WFH.find({ isDeleted: { $ne: true } })
      .sort({
        createdAt: -1,
      })
      .populate('userId');

    if (!wfhs || wfhs?.length === 0) {
      return wfhs;
    }

    return wfhs;
  }

  /**
   * Get a wfh by UserID.
   * @param {Object} params - Object containing the wfh ID.
   * @param {String} params.id - MongoDB ObjectId.
   * @returns {Promise<WFH>} - The found wfh.
   * @throws {ApiError} - If no wfh is found with the given ID.
   */
  async getWfhById({ id }) {
    const result = await WFH.find({ userId: id }).sort({ createdAt: -1 });
    if (!result || result?.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No WFH for the given user');
    }
    return result;
  }

  async getWfhTl({ id }) {
    const leadUsers = await User.find(
      {
        $or: [{ teamLeadId: id }, { subTeamLeadId: id }],
      },
      'id'
    );

    const userIds = leadUsers.map((user) => user?._id?.toString());
    userIds.push(id); // includes itself

    const wfhEntries = await WFH.find({ userId: { $in: userIds } }).populate(
      'userId'
    );

    return wfhEntries;
  }

  /**
   * Update a wfh by its ID
   * @param {String} id - MongoDB ObjectId
   * @param {Object} updateData - Validated update data
   * @returns {Promise<WFH|null>}
   */
  async updateWfh(wfhData) {
    const oldWfh = await WFH.findOne({
      _id: wfhData?.wfhId,
      isDeleted: false,
    });
    if (!oldWfh) {
      throw new ApiError(httpStatus.NOT_FOUND, 'WFH not found.');
    }
    if (oldWfh?.status !== 'pending') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Seems like status of wfh has already been changed. Refresh page to see changes.'
      );
    }
    oldWfh.status = wfhData?.status;
    if (wfhData?.status === 'approved') {
      oldWfh.approvedBy = wfhData?.edittorId;
      try {
        const markWFH = await attendanceService.createAttendance(
          oldWfh?.userId,
          wfhData?.status,
          oldWfh?._id,
          oldWfh?.date,
          'wfh'
        );
        // console.log(markWFH);
      } catch (err) {
        console.log(err);
      }
    } else if (wfhData?.status === 'rejected') {
      oldWfh.rejectedBy = wfhData?.edittorId;
    }
    return await oldWfh.save();
  }

  /**
   * Soft delete a wfh by its ID.
   * @param {Object} params - Object containing the wfh ID.
   * @param {string} params.id - The MongoDB ObjectId of the wfh to delete.
   * @returns {Promise<wfh>} - The updated wfh with isDeleted set to true.
   * @throws {ApiError} - If the wfh doesn't exist or is already deleted.
   */
  async deleteWfh({ id }) {
    const result = await WFH.findById(id);
    if (!result || result?.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No WFH on given date found');
    }
    if (result?.status === 'rejected') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'You cannot delete a rejected WFH.'
      );
    }
    result.status = 'revoked';
    return await result.save();
  }
}

module.exports = new wfhService();
