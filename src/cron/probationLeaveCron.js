const User = require('../models/userModel');
const Leave = require('../models/leaveModel');

async function updateProbationLeavesForAllUsers() {
  const today = new Date();

  // Only run on the 1st of the month
  if (today.getDate() !== 1) return;

  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const firstDayOfLastMonth = new Date(
    lastMonth.getFullYear(),
    lastMonth.getMonth(),
    1
  );
  const lastDayOfLastMonth = new Date(
    lastMonth.getFullYear(),
    lastMonth.getMonth() + 1,
    0
  );

  const probationUsers = await User.find({ status: 'probation' });

  for (const user of probationUsers) {
    const perMonth = user.leaves?.perMonth || 1;
    const carryForward = user.leaves?.carryForwardLeave?.total || 0;

    // Check if the user used a "perMonth" leave in last month
    const usedLeave = await Leave.findOne({
      userId: user._id,
      leaveType: 'perMonth',
      status: 'approved',
      date: {
        $gte: firstDayOfLastMonth,
        $lte: lastDayOfLastMonth,
      },
    });

    const unusedLeave = usedLeave ? 0 : perMonth;

    // Update carryForward leave
    user.leaves = {
      ...user.leaves,
      carryForwardLeave: {
        total: carryForward + unusedLeave,
      },
    };

    await user.save();
  }

  console.log(
    `[CRON] Updated probation leaves for ${probationUsers.length} users on ${today.toISOString()}`
  );
}

module.exports = updateProbationLeavesForAllUsers;
