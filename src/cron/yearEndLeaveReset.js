const logger = require('../config/logger');
const User = require('../models/userModel');
const mongoose = require('mongoose');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const LeaveType = require('../models/leaveTypeModel');
require('dotenv').config({ path: './.env.production' });

const mongoUri = process.env.MONGO_URI;

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// mongoose.connection.on('connected', () => {
//   logger.info('✅ MongoDB connected');
// });

// mongoose.connection.on('error', (err) => {
//   logger.error('❌ MongoDB connection error:', err);
//   process.exit(1);
// });

const runYearEndLeaveReset = async () => {
  logger.info('📅 Starting year-end leave reset job...');

  try {
    let users;
    try {
      users = await User.find({
        isDeleted: false,
        status: { $in: ['onroll', 'probation'] },
        leavePolicyId: { $exists: true },
      }).select('_id leavePolicyId');
    } catch (err) {
      logger.error('❌ Error fetching users:', { error: err.message, stack: err.stack });
      throw err;
    }
    const userIds = users.map((u) => u._id.toString());

    const leavePolicyIds = users.map((u) => u.leavePolicyId).filter(Boolean);
    let mappings;
    try {
      mappings = await LeavePolicyMapping.find({
        leavePolicyId: { $in: leavePolicyIds },
      });
    } catch (err) {
      logger.error('❌ Error fetching leave policy mappings:', { error: err.message, stack: err.stack });
      throw err;
    }

    const leaveTypeIds = mappings.map((m) => m.leaveTypeId.toString());
    let leaveTypes;
    try {
      leaveTypes = await LeaveType.find({ _id: { $in: leaveTypeIds } });
    } catch (err) {
      logger.error('❌ Error fetching leave types:', { error: err.message, stack: err.stack });
      throw err;
    }

    const leaveTypeMap = new Map();
    leaveTypes.forEach((lt) => leaveTypeMap.set(lt._id.toString(), lt));

    let balances;
    try {
      balances = await EmployeeLeaveBalance.find({
        userId: { $in: userIds },
      });
    } catch (err) {
      logger.error('❌ Error fetching employee leave balances:', { error: err.message, stack: err.stack });
      throw err;
    }

    const balancesMap = new Map();
    balances.forEach((b) => {
      balancesMap.set(`${b.userId.toString()}-${b.leaveTypeId.toString()}`, b);
    });

    for (const user of users) {
      if (!user.leavePolicyId) {
        logger.warn(`⚠️ User ${user._id} has no leave policy`);
        continue;
      }

      const userMappings = mappings.filter(
        (m) => m.leavePolicyId.toString() === user.leavePolicyId.toString()
      );

      for (const mapping of userMappings) {
        const {
          leaveTypeId,
          quota = 0,
          accrualType,
          accrualPerMonth = 0,
          maxCarryForward = 0,
        } = mapping;

        const leaveType = leaveTypeMap.get(leaveTypeId.toString());
        if (!leaveType) {
          logger.warn(`⚠️ LeaveType ${leaveTypeId} not found`);
          continue;
        }

        const key = `${user._id.toString()}-${leaveTypeId.toString()}`;
        const balance = balancesMap.get(key);

        if (!balance) {
          logger.warn(
            `⚠️ No existing balance for user ${user._id} & leaveType ${leaveTypeId}`
          );
          continue;
        }

        let carryForwarded = 0;
        let accrued = 0;

        if (accrualType === 'monthly') {
          // CASUAL leaves with monthly accrual should not be carry forwarded
          if (leaveType.code !== 'CASUAL' && maxCarryForward > 0 && balance.total > balance.used) {
            carryForwarded = Math.min(
              balance.total - balance.used,
              maxCarryForward
            );
          }
          accrued = 0; // Monthly accrual handled by monthly cron
        } else if (accrualType === 'yearly' || quota > 0) {
          // For fixed quota like Birthday
          accrued = quota;
          carryForwarded = 0;
        }

        if (quota === 0 && accrualType !== 'monthly') {
          logger.info(
            `ℹ️ Skipping ${leaveType.code} for user ${user._id} (no quota)`
          );
          continue;
        }

        balance.accrued = accrued;
        balance.used = 0;
        balance.carryForwarded = carryForwarded;
        balance.total = accrued + carryForwarded;

        try {
          await balance.save();
        } catch (err) {
          logger.error('❌ Error saving balance:', {
            error: err.message,
            stack: err.stack,
            userId: user._id,
            leaveTypeId: leaveTypeId,
            leaveTypeCode: leaveType.code
          });
          throw err;
        }
      }
    }

    logger.info('✅ Year-end leave reset completed.');
  } catch (err) {
    logger.error('❌ Error in year-end leave reset:', err);
  }
};

if (require.main === module) {
  runYearEndLeaveReset()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      logger.error('❌ Fatal error running year-end leave reset:', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}

module.exports = {
  runYearEndLeaveReset,
};
