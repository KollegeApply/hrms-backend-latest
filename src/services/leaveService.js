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
const { paginate } = require('../utility/common');

class leaveService {
  /**
   * Create a new Leave (HR/Admin only).
   * @param {object} leaveData - Validated leave data (includes reason, date, userId).
   * @returns {Promise<Leave>} - The created Leave document.
   * @throws {ApiError} - If a Leave already exists on the given date.
   */

  /**
   * Get all Leave (excluding soft-deleted ones).
   * @param {string} team - Team code to filter by
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Items per page (default: 10)
   * @returns {Promise<object>} - Paginated list of all non-deleted Leaves, sorted by date.
   */
  async getAllLeave(team, page = 1, limit = 10, financeTeamLeadId = null) {
    // Get all user IDs for the team
    const teamUsers = await User.find({ team }).select('_id');
    const teamUserIds = teamUsers.map(user => user._id);

    // Build query to filter by team users
    const query = {
      userId: { $in: teamUserIds },
      isDeleted: { $ne: true }
    };

    const populateOptions = [
      {
        path: 'userId',
        select: '_id firstName lastName employeeId workType hireDate',
        populate: [
          {
            path: 'department',
            select: 'name'
          },
          {
            path: 'teamLeadId',
            select: 'firstName lastName email employeeId'
          }
        ]
      },
      {
        path: 'leaveTypeId',
        select: 'name',
      }
    ];

    // If Finance TL, get their team members and prioritize them
    let teamMemberIds = [];
    let financeLeaderObjectId = null;
    if (financeTeamLeadId) {
      financeLeaderObjectId = new mongoose.Types.ObjectId(financeTeamLeadId);

      const teamMembers = await User.find({
        teamLeadId: financeLeaderObjectId
      }).select('_id');
      teamMemberIds = teamMembers.map((u) => u._id);
    }

    // Use aggregation to add priority field and sort
    if (financeLeaderObjectId && teamMemberIds.length > 0) {
      const skip = (page - 1) * limit;
      
      const pipeline = [
        { $match: query },
        {
          $addFields: {
            priority: {
              $switch: {
                branches: [
                  // 0: TL's own leave applications
                  {
                    case: { $eq: ['$userId', financeLeaderObjectId] },
                    then: 0,
                  },
                  // 1: Team members whose status is 'tl-pending'
                  {
                    case: {
                      $and: [
                        { $in: ['$userId', teamMemberIds] },
                        { $eq: ['$status', 'tl-pending'] },
                      ],
                    },
                    then: 1,
                  },
                  // 2: Remaining team members
                  {
                    case: { $in: ['$userId', teamMemberIds] },
                    then: 2,
                  },
                ],
                // 3: Everyone else
                default: 3,
              },
            }
          }
        },
        { $sort: { priority: 1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit }
      ];

      // Get total count for pagination
      const totalDocs = await LeaveApplication.countDocuments(query);

      // Execute aggregation with population
      let leaves = await LeaveApplication.aggregate(pipeline);

      // Manually populate the fields
      leaves = await LeaveApplication.populate(leaves, populateOptions);

      const totalPages = Math.ceil(totalDocs / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        data: leaves,
        pagination: {
          totalDocs,
          limit,
          totalPages,
          currentPage: page,
          pagingCounter: skip + 1,
          hasPrevPage,
          hasNextPage,
          prevPage: hasPrevPage ? page - 1 : null,
          nextPage: hasNextPage ? page + 1 : null,
        },
      };
    }

    // Default pagination for non-Finance TL users
    const paginationResult = await paginate(
      LeaveApplication,
      query,
      page,
      limit,
      { createdAt: -1 },
      null,
      populateOptions
    );

    return paginationResult;
  }

  /**
   * Get a Leave by UserID.
   * @param {Object} params - Object containing the leave ID.
   * @param {String} params.id - MongoDB ObjectId.
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Items per page (default: 10)
   * @returns {Promise<object>} - Paginated list of leaves for the user.
   */
  async getLeaveById({ id }, page = 1, limit = 10) {
    const query = {
      userId: id,
      isDeleted: { $ne: true }
    };

    const populateOptions = [
      {
        path: 'userId',
        select: '_id firstName lastName employeeId workType hireDate',
        populate: [
          {
            path: 'department',
            select: 'name'
          },
          {
            path: 'teamLeadId',
            select: 'firstName lastName email employeeId'
          }
        ]
      },
      {
        path: 'leaveTypeId',
        select: 'name',
      }
    ];

    const paginationResult = await paginate(
      LeaveApplication,
      query,
      page,
      limit,
      { createdAt: -1 },
      null,
      populateOptions
    );

    return paginationResult;
  }

  /**
   * Update a Leave by its ID
   * @param {String} id - MongoDB ObjectId
   * @param {Object} updateData - Validated update data
   * @returns {Promise<Leave|null>}
   */
async updateLeaveStatus({ leaveId, action, editor }) {
  // 1. Fetch the leave application
  const leave = await LeaveApplication.findById(leaveId).populate('leaveTypeId');
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave application not found.');
  }

  // Check if leave is deleted
  if (leave.isDeleted) {
    throw new ApiError(httpStatus.CONFLICT, 'Cannot modify a deleted leave application.');
  }

  const { role: editorRole, id: editorId } = editor;
  const currentStatus = leave.status;

  // Validate action parameter
  const validActions = ['approved', 'rejected', 'revoked'];
  if (!validActions.includes(action)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Invalid action '${action}'. Valid actions are: ${validActions.join(', ')}`);
  }

  const isTeamLead = ['teamlead', 'subteamlead'].includes(editorRole);
  const isAdminOrHR = ['admin', 'hr', 'subadmin'].includes(editorRole);
  
  // Helper function to check if user is the Team Lead of the employee
  const isUserTeamLeadOfEmployee = async (userId, employeeId) => {
    const employee = await User.findById(employeeId).select('teamLeadId subTeamLeadId');
    return employee && (
      employee.teamLeadId?.toString() === userId.toString() ||
      employee.subTeamLeadId?.toString() === userId.toString()
    );
  };
  
  // 2. State Machine: Determine the next state based on current state, action, and user role
  switch (currentStatus) {
    case 'tl-pending':
      // Check if user is Team Lead OR if user is HR/Admin and also the Team Lead of the employee
      const isActualTeamLead = isTeamLead || (isAdminOrHR && await isUserTeamLeadOfEmployee(editorId, leave.userId));
      
      if (isActualTeamLead) {
        if (action === 'approved') {
          leave.status = 'hr-pending';
          leave.tlApprovedBy = editorId;
          leave.approvedBy = editorId; // Backward compatibility
        } else if (action === 'rejected') {
          leave.status = 'tl-rejected';
          leave.tlRejectedBy = editorId;
          leave.rejectedBy = editorId; // Backward compatibility
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Invalid action '${action}' for a TL-pending leave.`);
        }
      } else if (editorId.toString() === leave.userId.toString() && action === 'revoked') {
        leave.status = 'revoked';
      } else {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only a Team Lead can action this leave.');
      }
      break;

    case 'hr-pending':
      if (isAdminOrHR) {
        if (action === 'approved') {
          // --- Side Effects for Approval ---
          // A. Update leave balance (for tracking purposes)
          const empBalance = await EmployeeLeaveBalance.findOne({
            userId: leave.userId,
            leaveTypeId: leave.leaveTypeId._id,
          });

          const daysToAdd = leave.totalDays || 0;

          if (leave.leaveTypeId.code !== 'LOP') {
            // For paid leaves: check balance and deduct
            const accrued = empBalance?.accrued || 0;
            const carryForwarded = empBalance?.carryForwarded || 0;
            const total = empBalance?.total || 0;
            const used = empBalance?.used || 0;

            // For regular leaves we use accrued+carryForwarded; for fixed‑quota
            // types (like Restricted) we may only have `total` populated.
            const baseEntitlement =
              accrued + carryForwarded > 0 ? accrued + carryForwarded : total;

            const available = baseEntitlement - used;

            if (!empBalance || available < daysToAdd) {
              throw new ApiError(
                httpStatus.CONFLICT,
                `Insufficient leave balance. Available: ${available}, Requested: ${daysToAdd}`
              );
            }

            empBalance.used += daysToAdd;
            await empBalance.save();
          } else {
            // For LOP leaves: just track usage without balance check
            if (empBalance) {
              empBalance.used += daysToAdd;
              await empBalance.save();
            }
          }

          // B. Create attendance records (now including LOP leaves)
          await attendanceService.bulkCreateOrUpdateLeaveAttendance(
            leave.userId, 
            leave._id, 
            leave.dates, 
            leave.isHalfDay, 
            leave.halfDayType,
            leave.leaveTypeId.code
          );

          // B.1 Smart late-approval handling for half-day leaves
          // If the leave is half-day, handle existing attendance records appropriately
          if (leave.isHalfDay && (leave.halfDayType === 'first' || leave.halfDayType === 'second')) {
            // Fetch user's shiftTime from user model
            const user = await User.findById(leave.userId).select('shiftTime').lean();
            const shiftTime = user?.shiftTime || null;

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

            // Iterate all leave dates and adjust if an attendance record already exists
            for (const date of leave.dates || []) {
              try {
                const dayStartIST = moment(date).tz('Asia/Kolkata').startOf('day').toDate();
                const attendance = await Attendance.findOne({ user: leave.userId, date: dayStartIST });
                if (!attendance) {
                  // No attendance record yet, bulkCreate will handle it
                  continue;
                }

                // If attendance exists, handle based on check-in and checkout status
                if (attendance.checkInTime && !attendance.checkOutTime) {
                  // Checked in but not checked out yet
                  // Keep original check-in status, just add leave linkage
                  attendance.leaveId = leave._id;
                  await attendance.save();
                } else if (attendance.checkInTime && attendance.checkOutTime) {
                  // Already checked out - apply 4.5h rule retroactively
                  const checkInMoment = moment(attendance.checkInTime).tz('Asia/Kolkata');
                  const checkOutMoment = moment(attendance.checkOutTime).tz('Asia/Kolkata');
                  const workDurationHours = checkOutMoment.diff(checkInMoment) / (1000 * 60 * 60);
                  
                  const halfDayWorkHours = 4.5;
                  let newStatus = attendance.status;

                  if (workDurationHours < halfDayWorkHours) {
                    // Worked less than 4.5 hours
                    if (attendance.status === 'present') {
                      newStatus = 'early_out';
                    } else if (attendance.status === 'late_in') {
                      newStatus = 'late_in_early_out';
                    }
                  }
                  // If worked >= 4.5 hours, keep original status

                  attendance.status = newStatus;
                  attendance.leaveId = leave._id;
                  await attendance.save();
                } else if (!attendance.checkInTime) {
                  // No check-in yet, apply normal half-day logic
                  const checkInMoment = moment(attendance.checkInTime).tz('Asia/Kolkata');
                  const checkInMinutes = checkInMoment.hours() * 60 + checkInMoment.minutes();

                  let normalizedStatus = attendance.status;

                  if (leave.halfDayType === 'first') {
                    // For first-half leave, being checked-in by firstHalfLeaveCutoff counts as on-time (present), else late_in
                    normalizedStatus = checkInMinutes <= firstHalfLeaveCutoff ? 'present' : 'late_in';
                  } else if (leave.halfDayType === 'second') {
                    // For second-half leave, apply the cutoff time (shiftTimeInMinutes or normalCutoff)
                    normalizedStatus = checkInMinutes <= cutoffTime ? 'present' : 'late_in';
                  }

                  attendance.status = normalizedStatus;
                  attendance.leaveId = leave._id;
                  await attendance.save();
                }
              } catch (normErr) {
                // Best-effort normalization; do not block approval on failure
                // Consider logging via central logger if available
                // console.error('Failed to normalize attendance after late approval:', normErr);
              }
            }
          }
          
          // C. Update the leave status
          leave.status = 'approved';
          leave.hrApprovedBy = editorId;
          leave.approvedBy = editorId; // Backward compatibility

        } else if (action === 'rejected') {
          leave.status = 'hr-rejected';
          leave.hrRejectedBy = editorId;
          leave.rejectedBy = editorId; // Backward compatibility
        } else {
          throw new ApiError(httpStatus.BAD_REQUEST, `Invalid action '${action}' for an HR-pending leave.`);
        }
      } else if (editorId.toString() === leave.userId.toString() && action === 'revoked') {
        leave.status = 'revoked';
      } else {
        throw new ApiError(httpStatus.FORBIDDEN, 'Only HR or an Admin can action this leave.');
      }
      break;

    case 'approved':
      // Logic for reverting an already approved leave (Admin/HR action)
      if (isAdminOrHR && action === 'rejected') {
          // A. Revert leave balance
          const empBalance = await EmployeeLeaveBalance.findOne({
            userId: leave.userId,
            leaveTypeId: leave.leaveTypeId._id,
          });
          
          if (empBalance) {
            const daysToRevert = leave.totalDays || 0;
            empBalance.used = Math.max(0, empBalance.used - daysToRevert);
            await empBalance.save();
          }
          // B. Revert attendance records (skip for LOP leaves)
          if (leave.leaveTypeId.code !== 'LOP') {
            await attendanceService.bulkRevertLeaveAttendance(leave.userId, leave._id, leave.dates);
          }
          
          // C. Update status
          leave.status = 'hr-rejected';
          leave.hrRejectedBy = editorId;
          leave.rejectedBy = editorId; // Backward compatibility
      } else {
          throw new ApiError(httpStatus.BAD_REQUEST, 'This leave has already been approved and cannot be changed.');
      }
      break;

    default:
      // Covers 'tl-rejected', 'hr-rejected', 'revoked', etc.
      throw new ApiError(httpStatus.CONFLICT, `Leave in '${currentStatus}' state cannot be modified.`);
  }

  // 3. Save the updated document
  return await leave.save();
}

  async getLeaveTl({ id, team }, page = 1, limit = 10) {
    const leadUsers = await User.find(
      {
        $or: [{ teamLeadId: id }, { subTeamLeadId: id }],
      },
      'id'
    );

    const userIds = leadUsers.map((user) => user._id.toString());
    userIds.push(id);

    const query = {
      userId: { $in: userIds },
      isDeleted: { $ne: true }
    };

    const populateOptions = [
      {
        path: 'userId',
        select: '_id firstName lastName employeeId workType hireDate',
        populate: [
          {
            path: 'department',
            select: 'name'
          },
          {
            path: 'teamLeadId',
            select: 'firstName lastName email employeeId'
          }
        ]
      },
      {
        path: 'leaveTypeId',
        select: 'name',
      }
    ];

    const paginationResult = await paginate(
      LeaveApplication,
      query,
      page,
      limit,
      { createdAt: -1 },
      null,
      populateOptions
    );

    return paginationResult;
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
      if (leaveApplication.status !== 'tl-pending' && leaveApplication.status !== 'hr-pending' && leaveApplication.status !== 'pending') {
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

async validateLeaveDates(userId, startDate, endDate, leaveTypeId, isHalfDay = false, halfDayType = null) {
    try {
      const today = moment().tz('Asia/Kolkata').startOf('day').toDate();

      // Parse dates in Asia/Kolkata timezone to avoid timezone conversion issues
      const startMoment = moment.tz(startDate, 'Asia/Kolkata').startOf('day');
      const endMoment = moment.tz(endDate, 'Asia/Kolkata').startOf('day');

      if (!startMoment.isValid() || !endMoment.isValid() || startMoment.isAfter(endMoment)) {
        return {
          isValid: false,
          reason: 'Invalid date range provided',
          rejectedReasons: ['Start date or end date is invalid'],
        };
      }
      
      // Keep dates as moment objects to avoid timezone conversion issues
      const currentDate = startMoment.clone();
      const lastDate = endMoment.clone();

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
        if (currentDate.month() !== moment(birthDate).month()) {
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
        status: { $in: ['pending', 'tl-pending', 'hr-pending'] },
      });

      let totalPendingDays = 0;
      pendingLeaves.forEach((leave) => {
        totalPendingDays += leave.totalDays;
      });

      const {
        accrued = 0,
        used = 0,
        carryForwarded = 0,
        total = 0,
      } = balance || {};

      // For most leave types we use accrued + carryForwarded.
      // For fixed‑quota types (like Restricted) we sometimes only store the quota in `total`,
      // with accrued=0. In that case, fall back to `total`.
      const baseEntitlement =
        accrued + carryForwarded > 0 ? accrued + carryForwarded : total;

      const totalAvailable =
        leaveType.code === 'LOP'
          ? Infinity
          : baseEntitlement - (used + totalPendingDays);

      const currentMonthStart = moment().tz('Asia/Kolkata').startOf('month').toDate();
      const currentMonthEnd = moment().tz('Asia/Kolkata').endOf('month').toDate();

      const [existingLeaves, existingAttendance] = await Promise.all([
        LeaveApplication.find({
          userId,
          status: { $in: ['approved', 'pending', 'tl-pending', 'hr-pending', 'tl-approved', 'hr-approved'] },
          isDeleted:false,
        }),
        Attendance.find({
          userId,
          date: { $gte: currentDate.toDate(), $lte: lastDate.toDate() },
        }),
      ]);
      
      ('=== EXISTING LEAVES DEBUG ===');
      ('Found existing leaves:', existingLeaves.length);
      existingLeaves.forEach((leave, index) => {
        (`Leave ${index + 1}:`, {
          id: leave._id,
          dates: leave.dates,
          status: leave.status,
          isHalfDay: leave.isHalfDay,
          halfDayType: leave.halfDayType,
          leaveTypeId: leave.leaveTypeId
        });
      });

      const existingLeaveDates = new Set();
      const existingHalfDayLeaves = new Map(); // Map to store half-day leave info by date
      const existingAttendanceDates = new Set();
      
      ('=== HALF-DAY LEAVES DEBUG ===');
      ('existingHalfDayLeaves:', existingHalfDayLeaves);

      existingLeaves.forEach((leave) => {
        leave.dates.forEach((date) => {
          const dateStr = formatDateOnly(date);
          const dateMoment = moment.tz(date, 'Asia/Kolkata').startOf('day');
          
          // Only consider leaves that overlap with the requested date range
          if (dateMoment.isSameOrAfter(currentDate, 'day') && dateMoment.isSameOrBefore(lastDate, 'day')) {
            existingLeaveDates.add(dateStr);
            
            // Store half-day leave information
            if (leave.isHalfDay && leave.halfDayType) {
              if (!existingHalfDayLeaves.has(dateStr)) {
                existingHalfDayLeaves.set(dateStr, []);
              }
              existingHalfDayLeaves.get(dateStr).push({
                halfDayType: leave.halfDayType,
                leaveId: leave._id
              });
            }
          }
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
      
      let pointer = currentDate.clone();

      while (pointer.isSameOrBefore(endMoment, 'day')) {
        const dateStr = pointer.format('YYYY-MM-DD');
        const istDay = pointer.day(); // 0 = Sunday, 1 = Monday...
        (`Processing date: ${dateStr}, existingLeaveDates has: ${existingLeaveDates.has(dateStr)}`);
        
        if (istDay === 0) {
          // addReason('Sunday', dateStr);
        } else if (existingLeaveDates.has(dateStr)) {
          // Check if it's a half-day leave conflict
          (`Date ${dateStr} has existing leave. isHalfDay: ${isHalfDay}, existingHalfDayLeaves.has: ${existingHalfDayLeaves.has(dateStr)}`);
          if (isHalfDay && existingHalfDayLeaves.has(dateStr)) {
            const existingHalfDays = existingHalfDayLeaves.get(dateStr);
            const hasSameHalfDay = existingHalfDays.some(existing => existing.halfDayType === halfDayType);
            
            if (hasSameHalfDay) {
              addReason(`You already have ${halfDayType === 'first' ? 'first half' : 'second half'} leave applied on this date`, dateStr);
            } else {
              // Different half-day, allow it
              const dateInKolkata = moment.tz(pointer.format('YYYY-MM-DD'), 'Asia/Kolkata').startOf('day').toDate();
              validDates.push(dateInKolkata);
            }
          } else if (!isHalfDay && existingHalfDayLeaves.has(dateStr)) {
            // Trying to apply full-day leave when half-day leave already exists
            const existingHalfDays = existingHalfDayLeaves.get(dateStr);
            const halfDayTypes = existingHalfDays.map(existing => existing.halfDayType).join(' and ');
            addReason(`Cannot apply full-day leave. You already have ${halfDayTypes} half-day leave applied on this date`, dateStr);
          } else if (isHalfDay && !existingHalfDayLeaves.has(dateStr)) {
            // Trying to apply half-day leave when full-day leave already exists
            addReason(`Cannot apply half-day leave. You already have a full-day leave applied on this date`, dateStr);
          } else {
            // Full day leave already exists or no half-day conflict
            addReason('You already have a leave applied on this date', dateStr);
          }
        } else if (existingAttendanceDates.has(dateStr)) {
          // Check if attendance conflicts with half-day leave
          if (isHalfDay) {
            // For half-day leaves, we need to check the specific attendance status
            const attendanceRecord = existingAttendance.find(att => formatDateOnly(att.date) === dateStr);
            if (attendanceRecord) {
              const status = attendanceRecord.status;
              if (status === 'leave_applied_full') {
                addReason('Cannot apply half-day leave. You already have a full-day leave applied on this date', dateStr);
              } else if (status === 'leave_applied_first_half' && halfDayType === 'first') {
                addReason('Already applied first half leave', dateStr);
              } else if (status === 'leave_applied_second_half' && halfDayType === 'second') {
                addReason('Already applied second half leave', dateStr);
              } else {
                // Allow post-check-in leave applications (present, late_in, early_out, etc.)
                // or different half-day types
                const dateInKolkata = moment.tz(pointer.format('YYYY-MM-DD'), 'Asia/Kolkata').startOf('day').toDate();
                validDates.push(dateInKolkata);
              }
            }
          } else {
            // For full-day leaves, block if attendance already marked
            addReason('Attendance already marked', dateStr);
          }
        } else {
          const holiday = await Holiday.findOne({
            date: {
              $gte: pointer.toDate(),
              $lt: pointer.clone().add(1, 'day').toDate(),
            },
            isDeleted: false,
          });

          if (holiday) {
            // Special rule: allow applying RESTRICTED leave on Restricted holidays.
            if (
              leaveType.code === 'RESTRICTED' &&
              holiday.holidayType === 'Restricted'
            ) {
              const dateInKolkata = moment
                .tz(pointer.format('YYYY-MM-DD'), 'Asia/Kolkata')
                .startOf('day')
                .toDate();
              validDates.push(dateInKolkata);
            } else {
              addReason(`Holiday (${holiday.name})`, dateStr);
            }
          } else {
            // Create date in Asia/Kolkata timezone to avoid timezone conversion issues
            const dateInKolkata = moment
              .tz(pointer.format('YYYY-MM-DD'), 'Asia/Kolkata')
              .startOf('day')
              .toDate();
            validDates.push(dateInKolkata);
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

      // ✅ 11. First 30 Days Check - Auto-reject PROBATION leaves within first 30 days from joining

      const hireDate = moment.tz(employee.hireDate, 'Asia/Kolkata').startOf('day');
      const leaveStartDate = currentDate.clone();
      
      // Calculate days difference between hire date and leave start date
      const daysDifference = leaveStartDate.diff(hireDate, 'days');

      // Auto-reject if PROBATION leave is applied within first 30 days from joining
      const isProbationLeave = leaveType.code === 'PROBATION';
      if (isProbationLeave && daysDifference >= 0 && daysDifference < 30) {
        // Calculate requested days considering half-day logic
        let requestedDays = validDates.length;
        if (isHalfDay) {
          requestedDays = validDates.length * 0.5;
        }
        
        const availableAfterRequest = totalAvailable - requestedDays;

        if (availableAfterRequest < 0) {
          return {
            isValid: false,
            reason: `Insufficient leave balance. Available: ${Math.floor(totalAvailable)}, Requested: ${requestedDays}`,
            rejectedReasons: [
              `Insufficient leave balance. Available: ${Math.floor(totalAvailable)}, Requested: ${requestedDays}`,
            ],
            dates: validDates,
          };
        }

        return {
          isValid: true,
          autoReject: true,
          autoRejectReason: `Auto-rejected: Probation leave applications are not allowed within the first 30 days from joining date (${hireDate.format('DD MMM YYYY')}). If you have an emergency, please contact HR.`,
          rejectedReasons: [
            `Auto-rejected: Probation leave applications are not allowed within the first 30 days from joining date (${hireDate.format('DD MMM YYYY')}). If you have an emergency, please contact HR.`,
          ],
          dates: validDates,
        };
      }

      // Calculate total requested days considering half-day logic
      let totalRequestedDays = validDates.length;
      if (isHalfDay) {
        totalRequestedDays = validDates.length * 0.5; // Half day = 0.5 days
      }

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
      

      if (validDates.length === 0) {
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
      status: { $in: ['approved', 'pending', 'tl-approved', 'hr-approved'] },
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
      status: { $in: ['approved', 'pending', 'tl-approved', 'hr-approved'] },
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
            status: { $in: ['approved', 'pending', 'tl-approved', 'hr-approved'] },
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
            status: { $in: ['approved', 'pending', 'tl-approved', 'hr-approved'] },
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
          status: { $in: ['approved', 'pending', 'tl-approved', 'hr-approved'] },
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
        isHalfDay = false,
        halfDayType,
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

      // Validate half-day fields
      if (isHalfDay && !halfDayType) {
        return {
          status: false,
          message: 'Half day type is required when half day is selected',
        };
      }

      if (isHalfDay && !['first', 'second'].includes(halfDayType)) {
        return {
          status: false,
          message: 'Invalid half day type. Must be "first" or "second"',
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
      ('=== LEAVE VALIDATION DEBUG ===');
      ('userId:', userId);
      ('startDate:', startDate);
      ('endDate:', endDate);
      ('leaveType:', leaveType);
      ('isHalfDay:', isHalfDay);
      
      const validationResult = await this.validateLeaveDates(
        userId,
        startDate,
        endDate,
        leaveType,
        isHalfDay,
        halfDayType
      );
      
      ('validationResult:', validationResult);


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

      // Check if employee has a Team Lead
      const employee = await User.findById(userId).populate('teamLeadId subTeamLeadId');
      let initialStatus = 'tl-pending';
      
      // If employee has no TL, set status to hr-pending
      if (!employee.teamLeadId && !employee.subTeamLeadId) {
        initialStatus = 'hr-pending';
      }

      // Calculate total days based on half-day logic
      let totalDays = validationResult.dates.length;
      if (isHalfDay) {
        totalDays = validationResult.dates.length * 0.5; // Half day = 0.5 days
      }

      // Create leave application
      const leaveApplication = new LeaveApplication({
        userId,
        leaveTypeId: leaveTypeDoc._id,
        leaveReason: reason,
        dates: validationResult.dates,
        totalDays: totalDays,
        isUnpaid: leaveTypeDoc.code === 'LOP',
        isHalfDay: isHalfDay,
        halfDayType: isHalfDay ? halfDayType : undefined,
        status: initialStatus,
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
    if (currentUser.role === 'admin' || currentUser.role === 'subadmin'  || currentUser.role === 'hr') {
      return true;
    }

    // Team leads can take action on their team members' leaves
    if (currentUser.role === 'teamlead') {
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
