const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const LeaveType = require('../models/leaveTypeModel');
const User = require('../models/userModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const LeaveApplication = require('../models/leaveApplicationModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const leaveApplicationModel = require('../models/leaveApplicationModel');
const EmployeeHistory = require('../models/employeeHistory');

class EmployeeLeaveBalanceService {
  getYearBounds(year = new Date().getFullYear()) {
    return {
      yearStart: new Date(year, 0, 1),
      yearEnd: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  async getApprovedUsedDays(userId, leaveTypeId, yearStart, yearEnd) {
    const leaves = await leaveApplicationModel.find({
      userId,
      leaveTypeId,
      status: 'approved',
      isDeleted: false,
      dates: {
        $elemMatch: {
          $gte: yearStart,
          $lte: yearEnd,
        },
      },
    });

    return leaves.reduce((acc, leave) => acc + (leave.totalDays || 0), 0);
  }

  async consolidateDuplicateBalances(userId, leaveTypeId) {
    const records = await EmployeeLeaveBalance.find({ userId, leaveTypeId }).sort({
      updatedAt: -1,
      _id: -1,
    });

    if (records.length === 0) return null;
    if (records.length === 1) return records[0];

    const canonical = records[0];
    for (const record of records) {
      canonical.used = Math.max(canonical.used || 0, record.used || 0);
      canonical.total = Math.max(canonical.total || 0, record.total || 0);
      canonical.accrued = Math.max(canonical.accrued || 0, record.accrued || 0);
      canonical.carryForwarded = Math.max(
        canonical.carryForwarded || 0,
        record.carryForwarded || 0
      );
    }

    const duplicateIds = records.slice(1).map((record) => record._id);
    await EmployeeLeaveBalance.deleteMany({ _id: { $in: duplicateIds } });
    canonical.updatedAt = new Date();
    await canonical.save();

    return canonical;
  }

  async getCanonicalBalance(userId, leaveTypeId, yearStart, yearEnd) {
    const balance = await this.consolidateDuplicateBalances(userId, leaveTypeId);
    if (!balance) return null;

    const approvedUsed = await this.getApprovedUsedDays(
      userId,
      leaveTypeId,
      yearStart,
      yearEnd
    );

    if (approvedUsed !== (balance.used || 0)) {
      balance.used = approvedUsed;
      balance.updatedAt = new Date();
      await balance.save();
    }

    return balance;
  }

  async consolidateAndSyncAllForEmployee(userId, yearStart, yearEnd) {
    const allBalances = await EmployeeLeaveBalance.find({ userId }).select(
      'leaveTypeId'
    );
    const leaveTypeIds = [
      ...new Set(allBalances.map((balance) => String(balance.leaveTypeId))),
    ];

    for (const leaveTypeId of leaveTypeIds) {
      await this.getCanonicalBalance(userId, leaveTypeId, yearStart, yearEnd);
    }
  }

  // Helper method to get status change date for probation to onroll transition
  async getStatusChangeDate(employeeId) {
    try {
      const statusChange = await EmployeeHistory.findOne({
        employeeId,
        entity: 'status',
        previous: 'probation',
        changed: 'onroll'
      }).sort({ actionAt: -1 });
      
      return statusChange ? statusChange.actionAt : null;
    } catch (error) {
      console.error('Error getting status change date:', error);
      return null;
    }
  }

  // Helper method to calculate probation leave for the probation period
  async calculateProbationLeaveForPeriod(employeeId, startDate, endDate) {
    try {
      // Get probation leave type
      const probationLeaveType = await LeaveType.findOne({ code: 'PROBATION' });
      if (!probationLeaveType) return 0;

      // Calculate months in probation period
      const start = new Date(startDate);
      const end = new Date(endDate);
      const monthsDiff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      
      // Probation accrual is 1 day per month
      const probationAccrued = monthsDiff * 1.0;

      // Get used probation leaves during this period
      const usedLeaves = await leaveApplicationModel.find({
        userId: employeeId,
        leaveTypeId: probationLeaveType._id,
        status: { $in: ['approved', 'pending', 'tl-pending', 'hr-pending'] },
        isDeleted: false,
        dates: {
          $gte: start,
          $lte: end
        }
      });

      const usedDays = usedLeaves.reduce((acc, leave) => acc + (leave.totalDays || 0), 0);
      
      return Math.max(0, probationAccrued - usedDays);
    } catch (error) {
      console.error('Error calculating probation leave:', error);
      return 0;
    }
  }

  // Get all leave balances for an employee for a year
  async getBalancesForEmployee(employeeId) {
    try {
      const currentYear = new Date().getFullYear();
      const { yearStart: currentYearStart, yearEnd: currentYearEnd } =
        this.getYearBounds(currentYear);

      // 1. Get user with leave policy
      const user = await User.findById(employeeId).populate('leavePolicyId');
      if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

      // Merge duplicate balance rows and sync used from approved applications
      await this.consolidateAndSyncAllForEmployee(
        employeeId,
        currentYearStart,
        currentYearEnd
      );

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
        
        // LOP (Loss of Pay) is available to all users regardless of status
        if (code === 'LOP') return true;
        
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

            let accrued = 0;
            let carryForwarded = balance?.carryForwarded || 0;
            
            // Special handling for LOP (Loss of Pay) - unlimited for all users
            if (leaveType.code === 'LOP') {
              accrued = 999; // Set a high number to indicate unlimited
            } else if (user.status === 'onroll') {
              // Check if employee transitioned from probation to onroll this year
              const statusChangeDate = await this.getStatusChangeDate(employeeId);
              
              if (statusChangeDate && statusChangeDate.getFullYear() === currentYear) {
                // Employee transitioned from probation to onroll this year
                const hireDate = new Date(user.hireDate);
                const probationEndDate = statusChangeDate;
                const yearEnd = new Date(currentYear, 11, 31);
                
                // Calculate probation leave for probation period
                const unusedProbationLeave = await this.calculateProbationLeaveForPeriod(
                  employeeId, 
                  hireDate, 
                  probationEndDate
                );
                
                // Calculate annual leave for onroll period
                const onrollStartMonth = statusChangeDate.getMonth();
                const onrollMonths = 12 - onrollStartMonth;
                
                if (mapping.accrualType === 'monthly') {
                  accrued = onrollMonths * mapping.accrualPerMonth;
                } else {
                  accrued = mapping.quota;
                }
                
                // Carry forward unused probation leave (no penalty)
                if (leaveType.code === 'ANNUAL') {
                  carryForwarded = unusedProbationLeave;
                }
              } else {
                // Normal onroll employee - calculate from hire date
                const remainingMonths = (() => {
                  if (hireYear < currentYear) return 12;
                  if (hireYear === currentYear) return 12 - hireMonth;
                  return 0;
                })();
                
                accrued = mapping.accrualType === 'monthly'
                  ? remainingMonths * mapping.accrualPerMonth
                  : mapping.quota;
              }
            } else {
              // Probation employee
              accrued = balance?.total || 0;
            }

            const pendingLeaves = await leaveApplicationModel.find({
              userId: employeeId,
              leaveTypeId: leaveType._id,
              status: { $in: ['pending', 'tl-pending', 'hr-pending'] },
              isDeleted: false,
              dates: {
                $elemMatch: {
                  $gte: currentYearStart,
                  $lte: currentYearEnd,
                },
              },
            });
            const pendingDays = pendingLeaves.reduce((acc, leave) => {
              return acc + (leave.totalDays || 0);
            }, 0);

            const used = balance?.used || 0;

            const totalProjected = Math.floor(accrued + carryForwarded);
            
            // Special handling for LOP
            let available = 0;
            if (leaveType.code === 'LOP') {
              available = 999;
            } else {
              available = Math.floor(
                (balance?.total || 0) - used - pendingDays
              );
            }

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
