const User = require('../models/userModel');
const Leave = require('../models/leaveModel');
const { calculateOnRollLeave } = require('../utility/leaveCalculation');

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
            leaveType: 'annual',
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

      const newLeaveEntitlements = calculateOnRollLeave(effectiveHireDate);

      await User.findByIdAndUpdate(user._id, {
        $set: {
          'leaves.annualLeave': newLeaveEntitlements.annualLeave,
          'leaves.casualSickLeave': newLeaveEntitlements.casualSickLeave,
          'leaves.bereavementLeave': newLeaveEntitlements.bereavementLeave,
          'leaves.marriageLeave': newLeaveEntitlements.marriageLeave,
          'leaves.birthdayLeave': newLeaveEntitlements.birthdayLeave,
          'leaves.carryForwardLeave.total': newCarryForwardTotal,
          'leaves.total':
            newLeaveEntitlements.annualLeave.total +
            newLeaveEntitlements.casualSickLeave.total +
            newLeaveEntitlements.bereavementLeave.total +
            newLeaveEntitlements.marriageLeave.total +
            newLeaveEntitlements.birthdayLeave.total +
            newCarryForwardTotal,
        },
      });

      console.log(`✅ ${user.name}: carried forward ${remaining} days`);
    }

    console.log('✅ Annual leave reset completed.');
  } catch (error) {
    console.error('❌ Error during annual leave reset:', error);
  }
}

module.exports = resetAnnualLeaves;
