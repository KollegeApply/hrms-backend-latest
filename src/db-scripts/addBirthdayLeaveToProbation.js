/**
 * Script to add Birthday Leave to Probation Policy
 * This allows probation employees to apply for birthday leave
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
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

const LeavePolicy = require('../models/leavePolicyModel');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const User = require('../models/userModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');

async function addBirthdayLeaveToProbationPolicy() {
  try {
    console.log('🚀 Starting script to add Birthday Leave to Probation Policy...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully\n');

    // Find Probation Policy
    const probationPolicy = await LeavePolicy.findOne({ 
      name: 'Probation Policy',
      isDeleted: false 
    });

    if (!probationPolicy) {
      throw new Error('Probation Policy not found. Please ensure the policy exists.');
    }
    console.log(`✅ Found Probation Policy: ${probationPolicy.name} (ID: ${probationPolicy._id})\n`);

    // Find Birthday Leave Type
    const birthdayLeaveType = await LeaveType.findOne({ 
      code: 'BIRTHDAY',
      isDeleted: false 
    });

    if (!birthdayLeaveType) {
      throw new Error('Birthday Leave Type not found. Please ensure the leave type with code "BIRTHDAY" exists.');
    }
    console.log(`✅ Found Birthday Leave Type: ${birthdayLeaveType.name} (Code: ${birthdayLeaveType.code})\n`);

    // Check if mapping already exists
    const existingMapping = await LeavePolicyMapping.findOne({
      leavePolicyId: probationPolicy._id,
      leaveTypeId: birthdayLeaveType._id,
      isDeleted: false,
    });

    if (existingMapping) {
      console.log('ℹ️  Birthday Leave mapping already exists for Probation Policy');
      console.log(`   Mapping ID: ${existingMapping._id}`);
      console.log(`   Quota: ${existingMapping.quota}`);
      console.log(`   Accrual Type: ${existingMapping.accrualType}\n`);
    } else {
      // Create new mapping
      // Birthday leave typically has quota of 1 day per year, no accrual
      const newMapping = await LeavePolicyMapping.create({
        leavePolicyId: probationPolicy._id,
        leaveTypeId: birthdayLeaveType._id,
        quota: 1, // 1 day per year
        accrualType: 'none', // Fixed quota, no monthly accrual
        accrualPerMonth: 0,
        maxCarryForward: 0, // Birthday leave usually doesn't carry forward
        isDeleted: false,
      });

      console.log('✅ Birthday Leave successfully added to Probation Policy');
      console.log(`   Mapping ID: ${newMapping._id}`);
      console.log(`   Quota: ${newMapping.quota} day per year`);
      console.log(`   Accrual Type: ${newMapping.accrualType}\n`);
    }

    // Create Birthday Leave balance documents for existing probation users
    const probationUsers = await User.find({
      status: 'probation',
      leavePolicyId: probationPolicy._id,
      isDeleted: { $ne: true }
    }).select('_id firstName lastName employeeId');

    console.log(`📋 Found ${probationUsers.length} probation users to update\n`);

    let balanceCreated = 0;
    let balanceSkipped = 0;

    for (const user of probationUsers) {
      // Check if user already has Birthday leave balance
      const existingBalance = await EmployeeLeaveBalance.findOne({
        userId: user._id,
        leaveTypeId: birthdayLeaveType._id,
        isDeleted: { $ne: true }
      });

      if (!existingBalance) {
        await EmployeeLeaveBalance.create({
          userId: user._id,
          leaveTypeId: birthdayLeaveType._id,
          accrued: 1, // Birthday leave is typically available immediately
          used: 0,
          carryForwarded: 0,
          total: 1,
        });
        balanceCreated++;
        console.log(`✅ Created Birthday leave balance for: ${user.firstName} ${user.lastName} (${user.employeeId || 'N/A'})`);
      } else {
        balanceSkipped++;
        console.log(`ℹ️  Birthday leave balance already exists for: ${user.firstName} ${user.lastName} (${user.employeeId || 'N/A'})`);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Probation Users Found: ${probationUsers.length}`);
    console.log(`   Balance Created: ${balanceCreated}`);
    console.log(`   Balance Skipped: ${balanceSkipped}`);
    console.log('\n✅ Script completed successfully!');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script if executed directly
if (require.main === module) {
  addBirthdayLeaveToProbationPolicy();
}

module.exports = { addBirthdayLeaveToProbationPolicy };

