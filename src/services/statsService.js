const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
const Leave = require('../models/leaveModel');
const Attendance = require('../models/attendanceModel');
const { default: mongoose } = require('mongoose');
const leaveService = require('./leaveService');
const {
  SYSTEM_LAUNCH_YEAR,
  SYSTEM_START_MONTH,
} = require('../utility/constants');
const employeeLeaveBalanceModel = require('../models/employeeLeaveBalanceModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const leaveApplicationModel = require('../models/leaveApplicationModel');

class StatsService {
  /**
   * Get Monthly Stats for an Employee
   * @param {Object} params - Parameters for monthly stats
   * @param {String} params.userId - Employee ID
   * @returns {Object} - Monthly stats data
   */
  async getQuarterRange(date = new Date()) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    const year = date.getFullYear();
    const startMonth = (quarter - 1) * 3;
    const endMonth = startMonth + 2;

    const start = new Date(year, startMonth, 1);
    const end = new Date(year, endMonth + 1, 0); // Last day of endMonth

    return { start, end };
  }

  async getMonthlyStats({ userId }) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const todayDate = currentDate.getDate();

    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

    try {
      const user = await User.findById(userId);
      if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

      // 1. Get Holidays & Working Days
      const holidays = await Holiday.find({
        date: { $gte: startOfMonth, $lte: currentDate },
      });

      const sundaysCount = this.getSundaysInMonth(currentMonth, currentYear);

      const workingDaysElapsed = await this.getWorkingDaysElapsed(
        currentYear,
        currentMonth,
        todayDate,
        holidays
      );

      const totalWorkingDays = await this.getTotalWorkingDays(
        currentYear,
        currentMonth,
        holidays,
        sundaysCount
      );

      // 2. Attendance Calculation (Up to current date)
      const attendances = await Attendance.find({
        user: userId,
        date: { $gte: startOfMonth, $lte: currentDate },
        status: { $in: ['present', 'half_day'] },
      });

      const daysWorked = attendances.reduce(
        (sum, att) => sum + (att.status === 'half_day' ? 0.5 : 1),
        0
      );

      // 3. Leave Balance from EmployeeLeaveBalance
      const balances = await employeeLeaveBalanceModel
        .find({
          userId: userId,
        })
        .populate('leaveTypeId');

      const leaveAllowed = {};
      const leavesTaken = {};
      const leavesAvailable = {};

      balances.forEach((bal) => {
        const code = bal.leaveTypeId?.code;
        if (!code) return;

        const total = bal.total || 0;
        const used = bal.used || 0;

        leaveAllowed[code] = Math.floor(total);
        leavesTaken[code] = Math.floor(used);
        leavesAvailable[code] = Math.max(
          0,
          Math.floor(total) - Math.floor(used)
        );
      });

      // 4. Loss of Pay Calculation (based on difference)
      const lossOfPay = await this.calculateLossOfPay(
        userId,
        currentYear,
        currentMonth,
        todayDate,
        holidays
      );

      return {
        workingDays: totalWorkingDays,
        workingDaysElapsed,
        daysWorked: Number(daysWorked.toFixed(1)),
        leaveAllowed,
        leavesTaken,
        leavesAvailable,
        lossOfPayDays: lossOfPay,
      };
    } catch (error) {
      console.error('Error in getMonthlyStats:', error);
      throw error;
    }
  }

  // Helper Methods
  async getWorkingDaysElapsed(year, month, dayOfMonth, holidays) {
    let count = 0;
    const holidayDates = holidays.map(
      (h) => h.date.toISOString().split('T')[0]
    );

    for (let day = 1; day <= dayOfMonth; day++) {
      const date = new Date(year, month, day);
      const isHoliday = holidayDates.includes(date.toISOString().split('T')[0]);
      if (date.getDay() !== 0 && !isHoliday) count++;
    }
    return count;
  }

  async getTotalWorkingDays(year, month, holidays, sundaysCount) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return daysInMonth - holidays.length - sundaysCount;
  }

  calculateLeaveAvailability(user, currentDate, leavesTakenMap) {
    const currentQuarter = Math.ceil((currentDate.getMonth() + 1) / 3);
    const quarterlyLeaveTypes = ['annualLeave', 'casualSickLeave'];
    const carryForwardType = 'carryForwardLeave';

    // Initialize accumulator
    const acc = {
      currentQuarter,
      leaveAllowed: {},
      leavesTaken: {},
      leavesAvailable: {},
    };

    // Handle quarterly leaves
    quarterlyLeaveTypes.forEach((type) => {
      const quarters = user.leaves?.[type]?.quarters || [];
      const quarterlyAllocation =
        quarters.find((q) => q.quarter === currentQuarter)?.total || 0;
      const taken = leavesTakenMap[type] || 0;

      acc.leaveAllowed[type] = quarterlyAllocation;
      acc.leavesTaken[type] = taken;
      acc.leavesAvailable[type] = Math.max(0, quarterlyAllocation - taken);
    });

    // Handle carryForwardLeave separately (no quarters)
    const carryForwardTotal = user.leaves?.[carryForwardType]?.total || 0;
    const carryForwardTaken = leavesTakenMap[carryForwardType] || 0;

    acc.leaveAllowed[carryForwardType] = carryForwardTotal;
    acc.leavesTaken[carryForwardType] = carryForwardTaken;
    acc.leavesAvailable[carryForwardType] = Math.max(
      0,
      carryForwardTotal - carryForwardTaken
    );

    return acc;
  }

  async calculateLossOfPay(userId, year, month, workingDaysElapsed, holidays) {
    const currentDate = new Date();
    const today = currentDate.getDate();

    // Get all attendance records in current month
    const attendances = await Attendance.find({
      user: userId,
      date: {
        $gte: new Date(year, month, 1),
        $lte: new Date(year, month, today),
      },
    });

    const attendanceDates = new Set(
      attendances.map((att) => att.date.toISOString().split('T')[0])
    );

    const holidayDates = holidays.map(
      (h) => h.date.toISOString().split('T')[0]
    );

    let lopDays = 0;

    for (let day = 1; day <= today; day++) {
      const date = new Date(year, month, day);
      const dayStr = date.toISOString().split('T')[0];

      const isWeekend = date.getDay() === 0; // Sunday
      const isHoliday = holidayDates.includes(dayStr);
      const hasAttendance = attendanceDates.has(dayStr);

      if (!isWeekend && !isHoliday && !hasAttendance) {
        lopDays += 1;
      }
    }

    return {
      actual: lopDays,
    };
  }

  getSundaysInMonth(month, year) {
    let sundays = 0;
    const date = new Date(year, month, 1);
    while (date.getMonth() === month) {
      if (date.getDay() === 0) sundays++;
      date.setDate(date.getDate() + 1);
    }
    return sundays;
  }

  // Helper method for pending leave loss days
  async calculatePendingLeaveLoss(userId, startDate, endDate) {
    const pendingLeaves = await Leave.find({
      userId,
      dates: { $gte: startDate, $lte: endDate },
      status: { $in: ['pending', 'rejected'] },
      isDeleted: false,
    });

    const pendingDays = new Set();
    pendingLeaves.forEach((leave) => {
      leave.dates.forEach((date) => {
        if (date >= startDate && date <= endDate) {
          pendingDays.add(date.toISOString().split('T')[0]);
        }
      });
    });

    return pendingDays.size;
  }

  /**
   * Get Yearly Stats for an Employee
   * @param {Object} params - Parameters for yearly stats
   * @param {String} params.userId - Employee ID
   * @returns {Object} - Yearly stats data
   */
  async getYearlyStats({ userId }) {
    const user = await User.findById(userId);
    if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

    const today = new Date();
    const currentYear = today.getFullYear();

    // Leave cycle: Jan 1 to Dec 31
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);

    // User's joining date
    const joinDate = user.hireDate ? new Date(user.hireDate) : startOfYear;

    // Determine effective start date
    let effectiveStartDate = joinDate > startOfYear ? joinDate : startOfYear;

    // Adjust for system launch year
    if (currentYear === SYSTEM_LAUNCH_YEAR) {
      effectiveStartDate =
        effectiveStartDate > new Date(SYSTEM_LAUNCH_YEAR, SYSTEM_START_MONTH, 1)
          ? effectiveStartDate
          : new Date(SYSTEM_LAUNCH_YEAR, SYSTEM_START_MONTH, 1);
    }

    // Get all leave balances for the user
    const leaveBalances = await employeeLeaveBalanceModel
      .find({ userId })
      .populate('leaveTypeId');

    // Get policy mappings for total yearly leaves available projected
    const policyMappings = await LeavePolicyMapping.find({
      leavePolicyId: user.leavePolicyId,
    }).populate('leaveTypeId');

    const hireMonth = effectiveStartDate.getMonth(); // 0-based (0 = Jan)
    const monthsEligible = 12 - hireMonth;

    const totalYearlyLeavesAvailable = policyMappings.reduce(
      (total, mapping) => {
        if (mapping.accrualType === 'monthly' && user.status === 'onroll') {
          return total + mapping.accrualPerMonth * monthsEligible;
        }
        return total + (mapping.quota || 0);
      },
      0
    );

    // Get annual leave balance specifically
    const annualLeaveBalance = leaveBalances.find(
      (balance) => balance.leaveTypeId?.code === 'ANNUAL'
    );

    // Get all approved leaves for the year
    const approvedLeaves = await leaveApplicationModel.find({
      userId,
      status: 'approved',
      isDeleted: false,
      dates: { $gte: effectiveStartDate, $lte: endOfYear },
    });

    // Populate leaveTypeId for each leave
    const populatedLeaves = await Promise.all(
      approvedLeaves.map((leave) => leave.populate('leaveTypeId'))
    );

    // Calculate total leaves taken
    const totalLeavesTaken = populatedLeaves.reduce((total, leave) => {
      return total + (leave.totalDays || 0);
    }, 0);

    // Calculate annual leaves used
    const annualLeavesUsed = populatedLeaves
      .filter((leave) => leave.leaveTypeId?.code === 'ANNUAL')
      .reduce((total, leave) => total + (leave.totalDays || 0), 0);

    // Get holidays in the period
    const holidays = await Holiday.find({
      date: { $gte: effectiveStartDate, $lte: today },
    });

    const totalWorkingDaysToDate = await this.getWorkingDaysUntilDate(
      today,
      holidays,
      effectiveStartDate
    );

    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: effectiveStartDate, $lte: today },
      status: { $in: ['present'] },
    });

    const daysWorked = attendances.length;

    const lossOfPayDays = Math.max(
      0,
      totalWorkingDaysToDate - daysWorked - totalLeavesTaken
    );

    return {
      totalYearlyLeavesAvailable: Math.round(totalYearlyLeavesAvailable),
      totalAnnualLeaveAllowed: annualLeaveBalance
        ? Math.round(annualLeaveBalance.total)
        : 0,
      totalYearlyLeavesTaken: Math.round(totalLeavesTaken),
      totalAnnualLeavesUsed: Math.round(annualLeavesUsed),
      lossOfPayDays: Math.round(lossOfPayDays),
    };
  }

  // Helper to calculate working days between two dates excluding Sundays and holidays
  async getWorkingDaysUntilDate(toDate, holidays = [], startDate = null) {
    // Default startDate: Jan 1 of current year
    const start = startDate || new Date(toDate.getFullYear(), 0, 1);
    const end = toDate;
    let workingDays = 0;

    // Convert holiday dates to strings for comparison
    const holidayDates = holidays.map((h) => new Date(h.date).toDateString());

    for (
      let date = new Date(start);
      date <= end;
      date.setDate(date.getDate() + 1)
    ) {
      console.log(date);
      const isSunday = date.getDay() === 0;
      const isHoliday = holidayDates.includes(date.toDateString());

      if (!isSunday && !isHoliday) {
        workingDays++;
      }
    }

    return workingDays;
  }

  // Helper Methods
  getSundaysInYear(year) {
    let sundays = 0;
    for (let month = 0; month < 12; month++) {
      sundays += this.getSundaysInMonth(month, year);
    }
    return sundays;
  }

  async getYearlyWorkingDays(year, holidays, sundaysCount) {
    const daysInYear =
      (year % 4 === 0 && year % 100 > 0) || year % 400 == 0 ? 366 : 365;
    return daysInYear - holidays.length - sundaysCount;
  }
}

module.exports = new StatsService();
