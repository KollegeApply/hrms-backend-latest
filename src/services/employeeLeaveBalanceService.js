const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const LeaveType = require('../models/leaveTypeModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const LeaveApplication = require('../models/leaveApplicationModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const leaveApplicationModel = require('../models/leaveApplicationModel');

class EmployeeLeaveBalanceService {
  // Get all leave balances for an employee for a year
  async getBalancesForEmployee(employeeId) {
    try {
      const currentYear = new Date().getFullYear();

      // 1. Get user with leave policy
      const user = await User.findById(employeeId).populate('leavePolicyId');
      if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

      // 2. Fetch policy mappings
      const policyMappings = await LeavePolicyMapping.find({
        leavePolicyId: user.leavePolicyId,
        isDeleted: false,
      }).populate('leaveTypeId');

      // 3. Fetch employee leave balances
      const balances = await EmployeeLeaveBalance.find({
        userId: employeeId,
      }).populate('leaveTypeId');

      // 4. Create map for fast lookup of leave balance by leaveTypeId
      const balanceMap = new Map();
      balances.forEach((b) => {
        // Handle cases where leaveTypeId might be null
        if (!b.leaveTypeId) return;

        // If leaveTypeId is populated, use _id, otherwise use the ID directly
        const typeId = b.leaveTypeId._id
          ? String(b.leaveTypeId._id)
          : String(b.leaveTypeId);
        balanceMap.set(typeId, b);
      });

      // 5. Filter policy mappings based on employee status
      const filteredMappings = policyMappings.filter((mapping) => {
        if (!mapping.leaveTypeId) return false;
        const code = mapping.leaveTypeId.code;
        if (!code) return false;
        return user.status === 'probation'
          ? code === 'PROBATION'
          : code !== 'PROBATION';
      });

      // 6. Generate simplified response
      const hireDate = new Date(user.hireDate);
      const hireYear = hireDate.getFullYear();
      const hireMonth = hireDate.getMonth();

      const response = await Promise.all(
        filteredMappings
          .filter(
            (mapping) =>
              mapping.leaveTypeId && mapping.leaveTypeId.code !== 'LOP'
          )
          .map(async (mapping) => {
            const leaveType = mapping.leaveTypeId;
            if (!leaveType) return null;

            const typeId = String(leaveType._id);
            const balance = balanceMap.get(typeId);

            // Calculate how many months the employee has worked in this year
            const remainingMonths = (() => {
              if (hireYear < currentYear) return 12;
              if (hireYear === currentYear) return 12 - hireMonth;
              return 0;
            })();

            let accrued = 0;
            if (user.status === 'onroll') {
              accrued =
                mapping.accrualType === 'monthly'
                  ? remainingMonths * mapping.accrualPerMonth
                  : mapping.quota;
            } else {
              accrued = balance?.total || 0;
            }

            const pendingLeaves = await leaveApplicationModel.find({
              userId: employeeId,
              leaveTypeId: leaveType._id,
              status: { $in: ['pending', 'tl-pending', 'hr-pending'] },
              isDeleted: false,
            });
            const pendingDays = pendingLeaves.reduce((acc, leave) => {
              return acc + (leave.totalDays || 0);
            }, 0);

            const carryForwarded = balance?.carryForwarded || 0;
            const used = balance?.used || 0;

            const totalProjected = Math.floor(accrued + carryForwarded);
            const available = Math.floor(
              (balance?.total || 0) - used - pendingDays
            );

            return {
              leaveTypeId: {
                _id: leaveType._id,
                name: leaveType.name,
                code: leaveType.code,
              },
              total: totalProjected,
              used,
              available: available < 0 ? 0 : available,
            };
          })
      );

      // Filter out null responses and return
      return response.filter(Boolean);
    } catch (error) {
      console.error('Error in getBalancesForEmployee:', error);
      throw error;
    }
  }

  // Accrue leave for an employee (called by cron or on-demand)
  async accrueLeave(employeeId, leaveTypeId, year, amount) {
    const balance = await EmployeeLeaveBalance.findOne({
      userId: employeeId,
      leaveTypeId,
      year,
    });
    if (balance) {
      balance.accrued += amount;
      balance.updatedAt = new Date();
      return balance.save();
    } else {
      return EmployeeLeaveBalance.create({
        userId: employeeId,
        leaveTypeId,
        year,
        accrued: amount,
        used: 0,
        carryForwarded: 0,
      });
    }
  }

  // Use leave (when leave is approved)
  async useLeave(employeeId, leaveTypeId, year, days) {
    const balance = await EmployeeLeaveBalance.findOne({
      userId: employeeId,
      leaveTypeId,
      year,
    });
    if (!balance)
      throw new ApiError(httpStatus.NOT_FOUND, 'Leave balance not found');
    if (balance.accrued - balance.used < days)
      throw new ApiError(httpStatus.BAD_REQUEST, 'Insufficient leave balance');
    balance.used += days;
    balance.updatedAt = new Date();
    return balance.save();
  }

  // Carry forward leave
  async carryForward(employeeId, leaveTypeId, year, amount) {
    const balance = await EmployeeLeaveBalance.findOne({
      userId: employeeId,
      leaveTypeId,
      year,
    });
    if (!balance)
      throw new ApiError(httpStatus.NOT_FOUND, 'Leave balance not found');
    balance.carryForwarded = amount;
    balance.updatedAt = new Date();
    return balance.save();
  }
}

module.exports = new EmployeeLeaveBalanceService();