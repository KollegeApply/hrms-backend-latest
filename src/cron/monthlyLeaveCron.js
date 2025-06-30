const mongoose = require('mongoose');
const logger = require('../config/logger');
const leavePolicyMappingModel = require('../models/leavePolicyMappingModel');
const employeeLeaveBalanceModel = require('../models/employeeLeaveBalanceModel');
require('dotenv').config({ path: './.env.production' });

const mongoUri = process.env.MONGO_URI;
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.on('connected', () => {
  logger.info('✅ MongoDB connected');
});

mongoose.connection.on('error', (err) => {
  logger.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

const runMonthlyLeaveAccrual = async () => {
  logger.info('📅 Starting monthly leave accrual job...');
  try {

    const mappings = await leavePolicyMappingModel.find({ accrualType: 'monthly' });

    const mappingMap = new Map();
    mappings.forEach((m) => {
      mappingMap.set(m.leaveTypeId.toString(), m);
    });

    const balances = await employeeLeaveBalanceModel.find({});

    const bulkOps = [];

    for (const balance of balances) {
      const mapping = mappingMap.get(balance.leaveTypeId.toString());
      if (mapping) {
        const accrual = mapping.accrualPerMonth || 0;

        bulkOps.push({
          updateOne: {
            filter: { _id: balance._id },
            update: {
              $inc: {
                accrued: accrual,
                total: accrual,
              },
            },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await employeeLeaveBalanceModel.bulkWrite(bulkOps);
    }

    logger.info(
      `✅ Monthly accrual complete. Updated ${bulkOps.length} balances.`
    );
  } catch (error) {
    console.error('❌ Error in monthly leave accrual:', error);
    logger.error('❌ Error in monthly leave accrual:', error);
  }
};

if (require.main === module) {
  runMonthlyLeaveAccrual()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error running monthly leave accrual:', err);
      process.exit(1);
    });
}

module.exports = {
  runMonthlyLeaveAccrual,
};
