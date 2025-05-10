const httpStatus = require('http-status');
const ApiError = require('../utility/ApiError');
const User = require('../models/userModel');
const WFH = require('../models/wfhModel');
const Holiday = require('../models/holidayModel');
const Leave = require('../models/leaveModel');
const Attendance = require('../models/attendanceModel');
const { getSundaysInMonth } = require('../utility/common');
const { default: mongoose } = require('mongoose');

class StatsService {
  /**
   * Get Monthly Stats for an Employee
   * @param {Object} params - Parameters for monthly stats
   * @param {String} params.userId - Employee ID
   * @returns {Object} - Monthly stats data
   */

  async getMonthlyStats({ userId }) {
    try {
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth();
      const startOfMonth = new Date(currentYear, currentMonth, 1);
      const endOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const startOfYear = new Date(currentYear, 0, 1);

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

      const sundaysCount = getSundaysInMonth(currentMonth, currentYear); // Ensure this function is defined.
      const workingDays = totalDaysInMonth - holidaysInMonth - sundaysCount;

      // 2. Days Worked:
      const daysWorked = await Attendance.countDocuments({
        userId,
        date: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $in: ['present', 'Half Day'] },
      });

      // 3. Leaves Taken Up to This Month (Optimized):
      const leavesTaken = await Leave.aggregate([
        {
          $match: {
            userId: mongoose.Types.ObjectId(userId),
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

      // 4. Leaves Available Up to This Month (Optimized):
      const carryForwardLeaves = await Leave.aggregate([
        {
          $match: {
            userId: mongoose.Types.ObjectId(userId),
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
        (user.leaves?.totalLeaves || 0) + carryForwardLeaves - leavesTaken;

      // 5. Emergency Leave Taken This Month:
      const emergencyLeaveTakenThisMonth = await Leave.aggregate([
        {
          $match: {
            userId: mongoose.Types.ObjectId(userId),
            leaveType: 'emergency',
            dates: { $gte: startOfMonth, $lte: endOfMonth }, // Changed to dates
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
            totalEmergencyLeave: { $sum: '$duration' },
          },
        },
      ]).then((res) => res[0]?.totalEmergencyLeave || 0);

      // 6. No Attendance (Loss Of Pay Days):  Simplified
      const lossOfPayDays = await Attendance.countDocuments({
        userId,
        date: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $nin: ['present', 'leave_applied', 'wfh_applied'] },
      });

      return {
        workingDays,
        daysWorked,
        leaves: {
          leavesAllowedUptoThisMonth: user.leaves?.annualLeave || 0, // Make it clearer.
          leavesTakenUpToThisMonth: leavesTaken,
          leavesAvailableUpToThisMonth: leavesAvailableUpToThisMonth,
          totalEmergencyLeave: emergencyLeaveTakenThisMonth,
        },
        lossOfPayDays,
      };
    } catch (error) {
      console.error(error);
      throw error; // Re-throw the error for the calling function to handle
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

    const totalLeavesAvailable = 24; // Example: Assuming 24 leaves annually

    const totalLeavesTaken = await Leave.countDocuments({
      userId,
      year: currentYear,
      isDeleted: false,
    });

    const annualLeavesTaken = await Leave.countDocuments({
      userId,
      year: currentYear,
      type: 'Annual',
      isDeleted: false,
    });

    const carryForwardLeaves = 5; // Example: Assuming 5 carry forward leaves
    const carryForwardUsed = await Leave.countDocuments({
      userId,
      year: currentYear,
      type: 'Carry Forward',
      isDeleted: false,
    });

    const compOffFiled = await Leave.countDocuments({
      userId,
      year: currentYear,
      type: 'Comp Off',
      isDeleted: false,
    });

    const lossOfPayDays = await Leave.countDocuments({
      userId,
      year: currentYear,
      isDeleted: false,
      lossOfPay: true,
    });

    return {
      totalLeavesAvailable,
      totalLeavesTaken,
      annualLeavesTaken,
      carryForwardLeaves,
      carryForwardUsed,
      compOffFiled,
      lossOfPayDays,
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
