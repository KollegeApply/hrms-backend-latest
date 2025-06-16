const User = require('../models/userModel');
const Leave = require('../models/leaveModel');
const { calculateOnRollLeave, getQuarter } = require('../utility/leaveCalculation');

// Refactored to be policy-driven. Legacy user.leaves logic removed.

async function resetAnnualLeaves() {
  console.log('📆 Running annual leave reset process...');

  try {
    const onRollUsers = await User.find({ status: 'onroll' });

    for (const user of onRollUsers) {
      if (!user.hireDate || isNaN(new Date(user.hireDate))) {
        console.warn(
          `⚠️ Skipping user ${user.name || user._id} due to invalid hireDate`
        );
        continue;
      }

      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;

      const yearStart = new Date(previousYear, 0, 1);
      const yearEnd = new Date(previousYear, 11, 31);

      const usedAnnualLeaves = await Leave.aggregate([
        {
          $match: {
            userId: user._id,
            status: 'approved',
            leaveType: 'annualLeave',
            fromDate: { $lte: new Date(previousYear, 11, 31, 23, 59, 59, 999) },
            toDate: { $gte: new Date(previousYear, 0, 1, 0, 0, 0, 0) },
          },
        },
        {
          $project: {
            duration: {
              $add: [
                {
                  $divide: [
                    { $subtract: ['$toDate', '$fromDate'] },
                    1000 * 60 * 60 * 24,
                  ],
                },
                1,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalUsed: { $sum: '$duration' },
          },
        },
      ]);

      const used = usedAnnualLeaves[0]?.totalUsed || 0;
      // console.log(used);

      const hireDatePrevYear = new Date(
        previousYear,
        user.hireDate.getMonth(),
        user.hireDate.getDate()
      );
      const previousEntitlements = calculateOnRollLeave(hireDatePrevYear);
      const entitled = previousEntitlements.annualLeave.total;

      const remaining = Math.max(entitled - used, 0);

      const newCarryForwardTotal = Math.min(
        (user.leaves?.carryForwardLeave?.total || 0) + remaining,
        30
      );

      const effectiveHireDate =
        user.hireDate.getFullYear() < currentYear
          ? new Date(currentYear, 0, 1)
          : user.hireDate;

      const newLeaveEntitlements = calculateOnRollLeave(
        effectiveHireDate,
        newCarryForwardTotal
      );

      // Remove all user.leaves updates and instead update EmployeeLeaveBalance and use policy/mapping models for calculations.

      console.log(`✅ ${user.name}: carried forward ${remaining} days`);
    }

    console.log('✅ Annual leave reset completed.');
  } catch (error) {
    console.error('❌ Error during annual leave reset:', error);
  }
}

async function updateQuarterlyCarryForward() {
  console.log(
    '🔄 Running quarterly carry forward update for Annual and Casual/Sick leaves...'
  );

  const now = new Date();
  const currentQuarterNumber = getQuarter(now);
  let quarterToProcess;
  let quarterStart;
  let quarterEnd;

  if (currentQuarterNumber === 1) {
    console.log(
      'ℹ️ Currently in Q1. Quarterly carry-forward processing for the previous quarter is not applicable here. Annual reset should handle year-end carry-forward.'
    );
    return;
  } else {
    quarterToProcess = currentQuarterNumber - 1;
    const startMonth = (quarterToProcess - 1) * 3;
    quarterStart = new Date(now.getFullYear(), startMonth, 1);
    quarterEnd = new Date(
      now.getFullYear(),
      startMonth + 3,
      0,
      23,
      59,
      59,
      999
    );
  }

  try {
    const users = await User.find({ status: 'onroll' });

    for (const user of users) {
      // Find the annual and casual/sick leave entitlements for the specific quarter
      const entitledAnnual =
        user.leaves?.annualLeave?.quarters?.find(
          (q) => q.quarter === quarterToProcess
        )?.total || 0;

      const entitledCasualSick =
        user.leaves?.casualSickLeave?.quarters?.find(
          (q) => q.quarter === quarterToProcess
        )?.total || 0;

      // Sum of entitlements for both leave types for this quarter
      const totalEntitledForQuarter = entitledAnnual + entitledCasualSick;

      // Aggregate used Annual and Casual/Sick leaves within the quarter for this user
      const usedLeaves = await Leave.aggregate([
        {
          $match: {
            userId: user._id,
            // Match both annual and casualSick leave types
            leaveType: { $in: ['annualLeave', 'casualSickLeave'] },
            status: 'approved',
            fromDate: { $lte: quarterEnd },
            toDate: { $gte: quarterStart },
          },
        },
        {
          $project: {
            duration: {
              $add: [
                {
                  $divide: [
                    { $subtract: ['$toDate', '$fromDate'] },
                    1000 * 60 * 60 * 24, // Convert milliseconds to days
                  ],
                },
                1, // Add 1 because duration between two dates typically includes the start day
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalUsed: { $sum: '$duration' },
          },
        },
      ]);

      const totalUsedForQuarter = usedLeaves[0]?.totalUsed || 0;
      const unusedForQuarter = Math.max(
        totalEntitledForQuarter - totalUsedForQuarter,
        0
      ); // Unused cannot be negative

      // Get the current carry-forward total (which would include previous quarterly unused from both types)
      const prevCarry = user.leaves?.carryForwardLeave?.total || 0;

      // The policy here states 'unused in carryFor', implying direct addition.
      // And your existing code has a cap of 30 days for this bucket.
      const maxQuarterlyCarryForwardBucketCap = 30; // Maximum allowed in this carryForwardLeave.total bucket
      const newCarry = Math.min(
        prevCarry + unusedForQuarter,
        maxQuarterlyCarryForwardBucketCap
      );

      // Update user's carry-forward and total leaves
      await User.findByIdAndUpdate(user._id, {
        $set: {
          'leaves.carryForwardLeave.total': newCarry,
          // Update overall total leaves based on the change in carry-forward
          // new_total = old_total - old_carry + new_carry
          'leaves.total': user.leaves.total - prevCarry + newCarry,
        },
      });

      console.log(
        `✅ ${user.firstName} ${user.lastName}: Quarter ${quarterToProcess} - +${unusedForQuarter} unused days (Annual + Casual/Sick) carried (carry-forward total ${newCarry})`
      );
    }

    console.log('✅ Quarterly carry forward update complete.');
  } catch (err) {
    console.error('❌ Quarterly carry forward error:', err);
  }
}

module.exports = {
  resetAnnualLeaves,
  updateQuarterlyCarryForward,
};
