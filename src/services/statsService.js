const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
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
const { startOfYear } = require('date-fns');

class StatsService {
  /**
   * Get Monthly Stats for an Employee
   * @param {Object} params - Parameters for monthly stats
   * @param {String} params.userId - Employee ID
   * @returns {Object} - Monthly stats data
   */

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

    // 1. Compute the three candidate start dates:
    const yearStart = startOfYear(today);
    const hireDate = user.hireDate ? new Date(user.hireDate) : yearStart;
    const systemLaunch = new Date(SYSTEM_LAUNCH_YEAR, SYSTEM_START_MONTH, 1);

    // 2. Effective start date is the latest of the three:
    const effectiveStartDate = new Date(
      Math.max(hireDate.getTime(), yearStart.getTime(), systemLaunch.getTime())
    );

    // 3. Year bounds for final queries:
    const endOfYear = new Date(currentYear, 11, 31);

    // 4. Load leave balances and policy mappings
    const leaveBalances = await employeeLeaveBalanceModel
      .find({ userId })
      .populate('leaveTypeId');

    const policyMappings = await LeavePolicyMapping.find({
      leavePolicyId: user.leavePolicyId,
    }).populate('leaveTypeId');

    // 5. Calculate “total yearly leaves available” (projected)
    const hireMonth = hireDate?.getMonth(); // 0-based
    const monthsElig = 12 - hireMonth;

    const totalYearlyLeavesAvailable = policyMappings.reduce((sum, mapping) => {
      if (mapping.accrualType === 'monthly' && user.status === 'onroll') {
        return sum + mapping.accrualPerMonth * monthsElig;
      }
      return sum + (mapping.quota || 0);
    }, 0);


    // 6. Find the user’s annual‐leave balance entry
    const annualLeaveBalance = leaveBalances.find(
      (bal) => bal.leaveTypeId?.code === 'ANNUAL'
    );

    // 7. Fetch ALL approved, **paid** leaves in the year (dates[]}):
    const approvedLeaves = await leaveApplicationModel
      .find({
        userId,
        status: 'approved',
        isUnpaid: false,
        isDeleted: false,
        dates: { $elemMatch: { $gte: effectiveStartDate, $lte: endOfYear } },
      })
      .populate('leaveTypeId');

    // 8. Sum up total days and annual leave days
    const totalLeavesTaken = approvedLeaves.reduce(
      (sum, leave) => sum + (leave.totalDays || 0),
      0
    );

    const annualLeavesUsed = approvedLeaves
      .filter((leave) => leave.leaveTypeId?.code === 'ANNUAL')
      .reduce((sum, leave) => sum + (leave.totalDays || 0), 0);

    // 9. Count holidays in the period
    const holidays = await Holiday.find({
      date: { $gte: effectiveStartDate, $lte: today },
    });

    // 10. Working days from effectiveStartDate → today (skips Sundays & holidays)
    const totalWorkingDaysToDate = await this.getWorkingDaysUntilDate(
      today,
      holidays,
      effectiveStartDate
    );

    // 11. Attendance = number of “present” days in that span
    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: effectiveStartDate, $lte: today },
      status: 'present',
    });
    const daysWorked = attendances.length;

    // 12. Loss-of-Pay days = workingDays – (worked + leavesTaken)
    const lossOfPayDays = Math.max(
      0,
      totalWorkingDaysToDate - daysWorked - totalLeavesTaken
    );

    return {
      totalYearlyLeavesAvailable: Math.round(totalYearlyLeavesAvailable),
      totalAnnualLeaveAllowed: annualLeaveBalance
        ? Math.floor(annualLeaveBalance.total)
        : 0,
      totalYearlyLeavesTaken: Math.round(totalLeavesTaken),
      totalAnnualLeavesUsed: Math.round(annualLeavesUsed),
      lossOfPayDays: Math.round(lossOfPayDays),
    };
  }

  // Helper to calculate working days between two dates excluding Sundays and holidays
  async getWorkingDaysUntilDate(toDate, holidays = [], startDate = null) {
    // Default startDate: Jan 1 of toDate’s year
    const start = startDate || new Date(toDate.getFullYear(), 0, 1);
    let workingDays = 0;

    const holidayDates = holidays.map((h) => new Date(h.date).toDateString());

    for (
      let date = new Date(start);
      date <= toDate;
      date.setDate(date.getDate() + 1)
    ) {
      const isSunday = date.getDay() === 0;
      const isHoliday = holidayDates.includes(date.toDateString());
      if (!isSunday && !isHoliday) workingDays++;
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
