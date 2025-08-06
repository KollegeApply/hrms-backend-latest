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
const moment = require('moment-timezone');

class leaveService {
  /**
   * Create a new Leave (HR/Admin only).
   * @param {object} leaveData - Validated leave data (includes reason, date, userId).
   * @returns {Promise<Leave>} - The created Leave document.
   * @throws {ApiError} - If a Leave already exists on the given date.
   */

  /**
   * Get all Leave (excluding soft-deleted ones).
   * @returns {Promise<Leave[]>} - List of all non-deleted Leaves, sorted by date.
   */
  async getAllLeave(team) {

  const leaves = await LeaveApplication.find()
      .sort({
        createdAt: -1,
      })
       .populate({
      path: 'userId',
      match: { team },
    })
      .populate({
        path: 'leaveTypeId',
        select: 'name',
      });

    if (!leaves || leaves?.length === 0) {
      return leaves;
    }

     return leaves.filter(leave => leave.userId !== null);
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
    if (!result) {
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
    }).populate('leaveTypeId');

    if (!oldLeave) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
    }

    // Allow status change from rejected to approved
    // if (oldLeave.status === 'approved') {
    //   throw new ApiError(409, 'Cannot modify approved leaves');
    // }

    // Allow only 'pending', 'approved' or 'auto-rejected' to be updated
    if (!['pending', 'auto-rejected', 'approved'].includes(oldLeave.status)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Leave status cannot be modified in its current state.'
      );
    }

    if (leaveData.status === 'approved') {
      oldLeave.status = leaveData.status;
      oldLeave.approvedBy = leaveData.edittorId;

      try {
        const leaveRecords = Array.isArray(leaveData.leaves)
          ? leaveData.leaves
          : [oldLeave];

        await Promise.all(
          leaveRecords.map(async (leave) => {
            // Fetch current balance
            const empBalance = await EmployeeLeaveBalance.findOne({
              userId: leave.userId,
              leaveTypeId: leave.leaveTypeId._id,
            });

            const total =
              (empBalance?.accrued || 0) + (empBalance?.carryForwarded || 0);
            const used = empBalance?.used || 0;
            const daysToAdd = leave.dates?.length || leave.totalDays || 0;

            if (total - used < daysToAdd) {
              throw new ApiError(
                409,
                `Cannot approve leave: Employee has insufficient leave balance. Available: ${total - used} days, Requested: ${daysToAdd} days.`
              );
            }

            // Proceed with attendance creation
            await attendanceService.bulkCreateOrUpdateLeaveAttendance(
              leave.userId,
              leave._id,
              leave.dates
            );

            if (empBalance) {
              empBalance.used = used + daysToAdd;
              empBalance.total = total;
              await empBalance.save();
            }
          })
        );
      } catch (err) {
        console.error('Error updating attendance or leave balance total:', err);
        throw err; // rethrow to prevent save on failure
      }
    } else if (
      oldLeave.status === 'approved' &&
      leaveData.status === 'rejected'
    ) {
      oldLeave.status = leaveData.status;
      // 1. Revert attendance
      await attendanceService.bulkRevertLeaveAttendance(
        oldLeave.userId,
        oldLeave._id,
        oldLeave.dates
      );

      // 2. Deduct leave from used
      const empBalance = await EmployeeLeaveBalance.findOne({
        userId: oldLeave.userId,
        leaveTypeId: oldLeave.leaveTypeId,
      });

      if (empBalance) {
        const daysUsed = oldLeave.dates?.length || oldLeave.totalDays || 0;
        empBalance.used = Math.max((empBalance.used || 0) - daysUsed, 0); // avoid negative
        await empBalance.save();
      }

      // 3. Set rejectedBy
      oldLeave.rejectedBy = leaveData.edittorId;
    } else if (leaveData.status === 'rejected') {
      oldLeave.status = leaveData.status;
      oldLeave.rejectedBy = leaveData.edittorId;
    }

    return await oldLeave.save();
  }

  async getLeaveTl({ id, team }) {
    const leadUsers = await User.find(
      {
        team: team, 
        $or: [{ teamLeadId: id }, { subTeamLeadId: id }],
      },
      'id'
    );

    const userIds = leadUsers.map((user) => user._id.toString());
    userIds.push(id);

    const leaveEntries = await LeaveApplication.find({
      userId: { $in: userIds },
    })
      .sort({ createdAt: -1 })
      .populate('userId')
      .populate('leaveTypeId');

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
      const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

      const startMoment = moment(startDate).tz('Asia/Kolkata').startOf('day');
      const endMoment = moment(endDate).tz('Asia/Kolkata').startOf('day');

      if (!startMoment.isValid() || !endMoment.isValid() || startMoment.isAfter(endMoment)) {
        return {
          isValid: false,
          reason: 'Invalid date range provided',
          rejectedReasons: ['Start date or end date is invalid'],
        };
      }
      
      const currentDate = startMoment.toDate();
      const lastDate = endMoment.toDate();

      const formatDateOnly = (date) => moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD');

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

      if (leaveType.code === 'BIRTHDAY') {
        const birthDate = new Date(employee.dateOfBirth);
        if (moment(currentDate).month() !== moment(birthDate).month()) {
          return {
            isValid: false,
            reason: 'Birthday leave can only be taken on your birthday month',
          };
        }
      }

      const balance = await EmployeeLeaveBalance.findOne({
        userId,
        leaveTypeId: leaveType._id,
      });

      const currentYear = moment().tz('Asia/Kolkata').year();
      
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
        leaveType.code === 'LOP'
          ? Infinity
          : accrued + carryForwarded - (used + totalPendingDays);

      const currentMonthStart = moment().tz('Asia/Kolkata').startOf('month').toDate();
      const currentMonthEnd = moment().tz('Asia/Kolkata').endOf('month').toDate();

      const [existingLeaves, existingAttendance] = await Promise.all([
        LeaveApplication.find({
          userId,
          status: { $in: ['approved', 'pending'] },
          dates: { $elemMatch: { $gte: startDate, $lte: endDate } },
          isDeleted:false,
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

      const validDates = [];
      const reasonMap = {};

      const addReason = (reason, dateStr) => {
        if (!reasonMap[reason]) {
          reasonMap[reason] = [];
        }
        reasonMap[reason].push(dateStr);
      };
      
      let pointer = moment(currentDate).tz('Asia/Kolkata');

      while (pointer.isSameOrBefore(endMoment, 'day')) {
        const dateStr = pointer.format('YYYY-MM-DD');
        const istDay = pointer.day(); // 0 = Sunday, 1 = Monday...
        if (istDay === 0) {
          // addReason('Sunday', dateStr);
        } else if (existingLeaveDates.has(dateStr)) {
          addReason('Already applied leave', dateStr);
        } else if (existingAttendanceDates.has(dateStr)) {
          addReason('Attendance already marked', dateStr);
        } else {
          const holiday = await Holiday.findOne({
            date: {
              $gte: pointer.toDate(),
              $lt: pointer.clone().add(1, 'day').toDate(),
            },
            isDeleted:false,
          });

          if (holiday) {
            // addReason(`Holiday (${holiday.name})`, dateStr);
          } else {
            validDates.push(pointer.toDate());
          }
        }

        pointer.add(1, 'day');
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

      if (leaveType.code === 'MARRIAGE') {
        const requestedDays = validDates.length;
        const quota = balance?.total - balance?.used || 5;

        if (requestedDays > quota) {
          return {
            isValid: false,
            reason: `Marriage leave cannot exceed ${quota} days. Requested: ${requestedDays}`,
            rejectedReasons: [
              `Requested: ${requestedDays}, Available: ${quota}`,
            ],
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
            reason: `Insufficient leave balance. Available: ${Math.floor(totalAvailable)}, Requested: ${validDates.length}`,
            rejectedReasons: [
              `Insufficient leave balance. Available: ${Math.floor(totalAvailable)}, Requested: ${validDates.length}`,
            ],
            dates: validDates,
          };
        }

        return {
          isValid: true,
          autoReject: true,
          rejectedReasons: [
            'Auto-rejected: Probation leave not allowed in first month. If you have an emergency, contact HR.',
          ],
          dates: validDates,
        };
      }

      const totalRequestedDays = validDates.length;
      const groupedRejectedReasons = Object.entries(reasonMap).map(
        ([reason, dates]) => `${reason}: ${dates.join(', ')}`
      );

      // Reject if any already-applied leave exists in the requested range
      if (reasonMap['Already applied leave']?.length > 0) {
        return {
          isValid: false,
          reason:
            'Some dates in the selected range have already been applied for.',
          rejectedReasons: groupedRejectedReasons,
        };
      }
      

      if (totalRequestedDays === 0) {
        return {
          isValid: false,
          reason: 'No valid leave dates found',
          rejectedReasons: groupedRejectedReasons,
        };
      }

      // For unpaid leave, skip balance check
      if (leaveType.code === 'LOP') {
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
          reason: `Insufficient leave balance. Available: ${Math.floor(totalAvailable)}, Requested: ${totalRequestedDays}`,
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
        isUnpaid: leaveTypeDoc.code === 'LOP',
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
