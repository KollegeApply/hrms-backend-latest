const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
const Leave = require('../models/leaveModel');
const Attendance = require('../models/attendanceModel');
const { default: mongoose } = require('mongoose');
const leaveService = require('./leaveService');

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
    const startOfYear = new Date(currentYear, 0, 1);

    try {
      const user = await User.findById(userId);
      if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');

      // 1. Get Base Data
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

      // 3. Leave Calculations (Up to current date)
      const leavesTaken = await Leave.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            status: 'approved',
            isDeleted: false,
          },
        },
        { $unwind: '$dates' },
        {
          $match: {
            dates: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: '$leaveType',
            total: { $sum: 1 },
          },
        },
      ]);

      const leavesTakenMap = leavesTaken.reduce(
        (acc, { _id, total }) => ({
          ...acc,
          [_id]: total,
        }),
        {}
      );

      // 4. Leave Availability Calculation
      const leaveAvailability = this.calculateLeaveAvailability(
        user,
        currentDate,
        leavesTakenMap
      );

      // 5. Loss of Pay Calculation
      const lossOfPay = this.calculateLossOfPay(
        workingDaysElapsed,
        daysWorked,
        leavesTakenMap,
        totalWorkingDays - workingDaysElapsed
      );

      return {
        workingDays: totalWorkingDays,
        workingDaysElapsed,
        daysWorked: Number(daysWorked.toFixed(1)),
        currentQuarter: leaveAvailability.currentQuarter,
        leaveAllowed: leaveAvailability.leaveAllowed,
        leavesTaken: leaveAvailability.leavesTaken,
        leavesAvailable: leaveAvailability.leavesAvailable,
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

  calculateLossOfPay(
    workingDaysElapsed,
    daysWorked,
    leavesTakenMap,
    workingDaysRemaining
  ) {
    const approvedLeaves = Object.values(leavesTakenMap).reduce(
      (sum, val) => sum + val,
      0
    );

    const actualLOP = Math.max(
      0,
      workingDaysElapsed - daysWorked - approvedLeaves
    );
    const projectedLOP = actualLOP + workingDaysRemaining;

    return {
      actual: Number(actualLOP.toFixed(1)),
      // projected: Number(projectedLOP.toFixed(1)),
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
    const currentYear = new Date().getFullYear();
    const endOfYear = new Date(currentYear, 11, 31);
    const today = new Date();

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    // Determine effective start date (joining date or Jan 1, whichever is later)
    const startOfYear = new Date(currentYear, 0, 1);
    const joinDate = user.hireDate ? new Date(user.hireDate) : startOfYear;
    const effectiveStartDate = joinDate > startOfYear ? joinDate : startOfYear;

    // Holidays up to today
    const holidays = await Holiday.find({
      date: { $gte: effectiveStartDate, $lte: today },
    });

    // Attendance up to today
    const attendances = await Attendance.find({
      user: userId,
      date: { $gte: effectiveStartDate, $lte: today },
      status: { $in: ['present', 'half_day'] },
    });

    const daysWorked = attendances.reduce(
      (sum, att) => sum + (att.status === 'half_day' ? 0.5 : 1),
      0
    );

    // Leaves in FULL YEAR
    const allLeaves = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: 'approved',
          isDeleted: false,
        },
      },
      { $unwind: '$dates' },
      {
        $match: {
          dates: { $gte: effectiveStartDate, $lte: endOfYear },
        },
      },
      {
        $group: {
          _id: '$leaveType',
          total: { $sum: 1 },
        },
      },
    ]);

    const fullYearLeaveMap = allLeaves.reduce((acc, { _id, total }) => {
      acc[_id] = total;
      return acc;
    }, {});

    // Leaves ONLY UP TO TODAY
    const leavesTillToday = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: 'approved',
          isDeleted: false,
        },
      },
      { $unwind: '$dates' },
      {
        $match: {
          dates: { $gte: effectiveStartDate, $lte: today },
        },
      },
      {
        $group: {
          _id: '$leaveType',
          total: { $sum: 1 },
        },
      },
    ]);

    const leavesTillTodayMap = leavesTillToday.reduce((acc, { _id, total }) => {
      acc[_id] = total;
      return acc;
    }, {});

    // Total working days till today (excluding holidays + Sundays)
    const totalWorkingDaysToDate = await this.getWorkingDaysUntilDate(
      today,
      holidays,
      effectiveStartDate
    );

    // Leave and carry forward info
    const totalAnnualLeaves = user.leaves?.annualLeave?.total || 0;
    const carryForwardTotal = user.leaves?.carryForwardLeave?.total || 0;
    const carryForwardUsed = fullYearLeaveMap.carryForwardLeave || 0;
    const carryForwardRemaining = Math.max(
      0,
      carryForwardTotal - carryForwardUsed
    );

    // LOP calculation
    const approvedLeaveDaysTillToday = Object.values(leavesTillTodayMap).reduce(
      (sum, val) => sum + val,
      0
    );

    const lossOfPayDays = Math.max(
      0,
      totalWorkingDaysToDate - daysWorked - approvedLeaveDaysTillToday
    );

    return {
      totalLeavesAllowed: user.leaves?.total || 0,
      totalAnnualLeaveAllowed: totalAnnualLeaves,
      totalLeavesTaken: Object.values(fullYearLeaveMap).reduce(
        (a, b) => a + b,
        0
      ),
      annualLeavesUsed: fullYearLeaveMap.annualLeave || 0,
      carryForwardLeaves: carryForwardTotal,
      carryForwardUsed: fullYearLeaveMap.carryForwardLeave || 0,
      carryForwardRemaining: carryForwardRemaining,
      lossOfPayDays: +lossOfPayDays.toFixed(1), // lop till today
    };
  }

  async getWorkingDaysUntilDate(toDate, holidays = [], startDate = null) {
    const start = startDate || new Date(toDate.getFullYear(), 0, 1);
    const end = toDate;
    let workingDays = 0;

    const holidayDates = holidays.map((h) => h.date.toDateString());

    for (
      let date = new Date(start);
      date <= end;
      date.setDate(date.getDate() + 1)
    ) {
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
