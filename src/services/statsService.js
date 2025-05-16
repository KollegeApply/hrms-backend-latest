const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
const Leave = require('../models/leaveModel');
const Attendance = require('../models/attendanceModel');
const { default: mongoose } = require('mongoose');

async function isHoliday(date) {
  const holiday = await Holiday.findOne({ date: date });
  return !!holiday; // Returns true if holiday exists, false otherwise
}

function getSundaysInMonth(month, year) {
  if (month < 0 || month > 11) {
    throw new Error('Month must be between 0 and 11');
  }
  let sundays = 0;
  let date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    if (date.getDay() === 0) {
      sundays++;
    }
    date.setDate(date.getDate() + 1);
  }
  return sundays;
}

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
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const startOfYear = new Date(currentYear, 0, 1);

    try {
      // Fetch user
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // 1. Working Days:
      const totalDaysInMonth = endOfMonth.getDate();
      const holidaysInMonth = await Holiday.find({
        date: { $gte: startOfMonth, $lte: endOfMonth },
      }).countDocuments();

      const sundaysCount = getSundaysInMonth(currentMonth, currentYear);
      const workingDays = totalDaysInMonth - holidaysInMonth - sundaysCount;

      const daysWorked = await Attendance.countDocuments({
        user: userId,
        date: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $in: ['present', 'Half Day'] },
      });

      // 2. Leaves Taken Up to This Month (Optimized):
      const leavesTaken = await Leave.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            dates: { $gte: startOfYear, $lte: endOfMonth },
            status: 'approved', // Only consider approved leaves
          },
        },
        {
          $project: {
            duration: { $size: '$dates' },
          },
        },
        {
          $group: {
            _id: null,
            totalLeaves: { $sum: '$duration' },
          },
        },
      ]).then((res) => res[0]?.totalLeaves || 0);

      // 3. Leaves Available Up to This Month (Optimized):
      const carryForwardLeaves = await Leave.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            dates: {
              $lt: startOfYear, // Dates before the start of the year
            },
          },
        },
        {
          $project: {
            duration: { $size: '$dates' },
          },
        },
        {
          $group: {
            _id: null,
            totalCarryForward: { $sum: '$duration' },
          },
        },
      ]).then((res) => res[0]?.totalCarryForward || 0);

      const leavesAvailableUpToThisMonth =
        (user.status === 'probation'
          ? user.leaves.perMonth
          : user.leaves?.total || 0) +
        carryForwardLeaves -
        leavesTaken;


      // Calculate working days *up to the current date*
      let workingDaysUptoToday = 0;
      let date = new Date(currentYear, currentMonth, 1);
      while (date <= currentDate) {
        if (date.getDay() !== 0 && !(await isHoliday(date))) {
          // 0 for Sunday, and check for holiday
          workingDaysUptoToday++;
        }
        date.setDate(date.getDate() + 1);
      }
      // 4. No Attendance (Loss Of Pay Days)
      const lossOfPayDays = workingDaysUptoToday - daysWorked;

      return {
        workingDays,
        daysWorked,
        leaves: {
          leavesAllowedUptoThisMonth:
            user.status === 'probation'
              ? user?.leaves?.perMonth
              : user?.leaves?.total || 0,
          leavesTakenUpToThisMonth: leavesTaken,
          leavesAvailableUpToThisMonth: leavesAvailableUpToThisMonth,
        },
        lossOfPayDays,
      };
    } catch (error) {
      console.error('Error fetching monthly stats:', error);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Internal Server Error'
      );
    }
  }

  /**
   * Get Yearly Stats for an Employee
   * @param {Object} params - Parameters for yearly stats
   * @param {String} params.userId - Employee ID
   * @returns {Object} - Yearly stats data
   */
  async getYearlyStats({ userId }) {
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);
    const today = new Date();

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    const isOnRoll = user.status === 'onroll';
    const isProbation = user.status === 'probation';
    const hireDate = user.hireDate ? new Date(user.hireDate) : null;

    let totalLeavesAllowed = 0;
    let annualLeavesAllowed = 0;
    let casualSickLeavesAllowed = 0;
    let bereavementLeavesAllowed = 0;
    let marriageLeavesAllowed = 0;
    let birthdayLeavesAllowed = 0;
    let annualLeavesAvailableUpToThisMonth = 0; // Initialize

    if (isOnRoll && user.leaves) {
      totalLeavesAllowed = user.leaves.total || 0;
      annualLeavesAllowed = user.leaves.annualLeave || 0;
      casualSickLeavesAllowed = user.leaves.casualSickLeave || 0;
      bereavementLeavesAllowed = user.leaves.bereavementLeaves || 0;
      marriageLeavesAllowed = user.leaves.marriageLeave || 0;
      birthdayLeavesAllowed = user.leaves.birthdayLeave || 0;

      // Adjust leaves proportionally based on joining month
      if (hireDate && hireDate.getFullYear() === currentYear) {
        const joiningMonth = hireDate.getMonth(); // 0-indexed
        const monthsRemaining = 12 - joiningMonth;

        annualLeavesAllowed = Math.floor((user.leaves.annualLeave || 0) * (monthsRemaining / 12));
        casualSickLeavesAllowed = Math.floor((user.leaves.casualSickLeave || 0) * (monthsRemaining / 12));
        bereavementLeavesAllowed = Math.floor((user.leaves.bereavementLeaves || 0) * (monthsRemaining / 12));
        marriageLeavesAllowed = Math.floor((user.leaves.marriageLeave || 0) * (monthsRemaining / 12));
        birthdayLeavesAllowed = hireDate.getDate() <= new Date(currentYear, joiningMonth).getDate() ? (user.leaves.birthdayLeave || 0) : 0;
        totalLeavesAllowed = annualLeavesAllowed + casualSickLeavesAllowed + bereavementLeavesAllowed + marriageLeavesAllowed + birthdayLeavesAllowed;

        // Calculate annual leaves available up to the current month for mid-year joiners
        const monthsWorkedThisYear = today.getMonth() - joiningMonth + (today.getFullYear() === currentYear ? 1 : 0);
        annualLeavesAvailableUpToThisMonth = Math.floor((user.leaves.annualLeave || 0) * (monthsWorkedThisYear / 12));

      } else {
        // Calculate annual leaves available up to the current month for users who joined before this year
        const currentMonth = today.getMonth(); // 0-indexed
        annualLeavesAvailableUpToThisMonth = Math.floor((user.leaves.annualLeave || 0) * ((currentMonth + 1) / 12));
      }
    } else if (isProbation) {
      totalLeavesAllowed = 0; // Probation users accrue monthly
    }

    let leavesAccruedThisYear = 0;
    if (isProbation && hireDate && hireDate.getFullYear() === currentYear) {
      const joiningMonth = hireDate.getMonth();
      const currentMonth = today.getMonth();
      leavesAccruedThisYear = Math.max(0, currentMonth - joiningMonth); // 1 leave per month after joining month
    } else if (isProbation) {
      const currentMonth = today.getMonth();
      leavesAccruedThisYear = currentMonth + 1; // Assuming joined before this year, accrue for all months
    }

    const totalLeavesTaken = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalLeaves: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalLeaves || 0);

    const annualLeavesUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Annual',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalAnnualUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalAnnualUsed || 0);

    const casualSickLeavesUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Casual/Sick',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const bereavementLeavesUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Bereavement',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const marriageLeavesUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Marriage',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const birthdayLeavesUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Birthday',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const carryForwardLeaves = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Carry Forward',
          dates: { $lt: startOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalCarryForward: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalCarryForward || 0);

    const carryForwardUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Carry Forward',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const carryForwardRemaining = carryForwardLeaves - carryForwardUsed;

    const totalLeavesAvailable = (isOnRoll ? totalLeavesAllowed : leavesAccruedThisYear) - totalLeavesTaken + carryForwardRemaining;
    const currentAnnualLeavesAvailable = annualLeavesAvailableUpToThisMonth - annualLeavesUsed;

    const compOffFiled = await Leave.countDocuments({
      userId,
      leaveType: 'Comp Off',
      dates: { $gte: startOfYear, $lte: endOfYear },
    });

    const compOffUsed = await Leave.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          leaveType: 'Comp Off',
          dates: { $gte: startOfYear, $lte: endOfYear },
          status: 'approved',
        },
      },
      {
        $project: {
          duration: { $size: '$dates' },
        },
      },
      {
        $group: {
          _id: null,
          totalUsed: { $sum: '$duration' },
        },
      },
    ]).then((res) => res[0]?.totalUsed || 0);

    const compOffRemaining = compOffFiled - compOffUsed;

    const lossOfPayDays = await Attendance.countDocuments({
      userId,
      date: { $gte: startOfYear, $lte: endOfYear },
      status: { $nin: ['present', 'leave_applied', 'wfh_applied'] },
    });

    return {
      totalLeavesAllowed,
      annualLeavesAllowed,
      casualSickLeavesAllowed,
      bereavementLeavesAllowed,
      marriageLeavesAllowed,
      birthdayLeavesAllowed,
      totalLeavesTaken,
      annualLeavesUsed,
      casualSickLeavesUsed,
      bereavementLeavesUsed,
      marriageLeavesUsed,
      birthdayLeavesUsed,
      totalLeavesAvailable,
      carryForwardLeaves,
      carryForwardUsed,
      carryForwardRemaining,
      compOffFiled,
      compOffUsed,
      compOffRemaining,
      lossOfPayDays,
      leavesAccruedThisYear,
      annualLeavesAvailableUpToThisMonth: currentAnnualLeavesAvailable < 0 ? 0 : currentAnnualLeavesAvailable // Return calculated available annual leave
    };
  }
  /**
   * Get Leave Application Stats
   * @param {Object} params - Parameters for leave application stats
   * @param {String} params.userId - Employee ID
   * @returns {Array} - List of leave applications
   */
  async getLeaveStats({ userId }) {
    const leaves = await Leave.find({
      userId,
      isDeleted: false,
    }).select('leaveId type filedAt startDate endDate status reason');

    if (!leaves || leaves.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No leave applications found.');
    }

    return leaves;
  }
}

module.exports = new StatsService();
