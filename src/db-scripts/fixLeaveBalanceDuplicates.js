const mongoose = require('mongoose');
const path = require('path');

if (process.env.NODE_ENV) {
  require('dotenv').config({
    path: `.env.${process.env.NODE_ENV}`,
  });
} else {
  // Try different env file locations
  const envPaths = [
    path.resolve(__dirname, '../../.env.development'),
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(__dirname, '../../.env'),
  ];

  for (const envPath of envPaths) {
    try {
      require('dotenv').config({ path: envPath });
      break;
    } catch (err) {
      // Continue to next path
    }
  }
}

const User = require('../models/userModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const employeeLeaveBalanceService = require('../services/employeeLeaveBalanceService');

async function fixLeaveBalanceDuplicates() {
  try {
    console.log('Starting leave balance duplicate fix...\n');

    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in MONGO_URI or DATABASE_URL');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB\n');

    const currentYear = new Date().getFullYear();
    const { yearStart, yearEnd } =
      employeeLeaveBalanceService.getYearBounds(currentYear);

    const duplicateGroups = await EmployeeLeaveBalance.aggregate([
      {
        $group: {
          _id: { userId: '$userId', leaveTypeId: '$leaveTypeId' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    console.log(`Found ${duplicateGroups.length} duplicate balance group(s)\n`);

    const users = await User.find({ isDeleted: false }).select('_id employeeId email');
    let processed = 0;

    for (const user of users) {
      await employeeLeaveBalanceService.consolidateAndSyncAllForEmployee(
        user._id,
        yearStart,
        yearEnd
      );
      processed += 1;
    }

    console.log(`Synced leave balances for ${processed} user(s)\n`);

    try {
      await EmployeeLeaveBalance.collection.createIndex(
        { userId: 1, leaveTypeId: 1 },
        { unique: true, name: 'userId_1_leaveTypeId_1_unique' }
      );
      console.log('Created unique index on userId + leaveTypeId\n');
    } catch (indexError) {
      if (indexError.code === 85 || indexError.codeName === 'IndexOptionsConflict') {
        console.log('Unique index already exists\n');
      } else {
        throw indexError;
      }
    }

    const remainingDuplicates = await EmployeeLeaveBalance.aggregate([
      {
        $group: {
          _id: { userId: '$userId', leaveTypeId: '$leaveTypeId' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    console.log('Leave balance fix complete.');
    console.log(`Remaining duplicate groups: ${remainingDuplicates.length}\n`);
  } catch (error) {
    console.error('Error fixing leave balances:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

if (require.main === module) {
  fixLeaveBalanceDuplicates()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { fixLeaveBalanceDuplicates };
