const mongoose = require('mongoose');
const path = require('path');

if (process.env.NODE_ENV) {
  require('dotenv').config({
    path: `.env.${process.env.NODE_ENV}`,
  });
} else {
  require('dotenv').config({
    path: path.resolve(__dirname, '../../.env.development'),
  });
}

const LeavePolicy = require('../models/leavePolicyModel');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const User = require('../models/userModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');

async function addRestrictedLeaveToAllUsers() {
  try {
    console.log('🚀 Starting Restricted Leave Setup Script...\n');

    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in MONGO_URI or DATABASE_URL');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');

    // Step 1: Find or create RESTRICTED leave type
    let restrictedLeaveType = await LeaveType.findOne({
      code: 'RESTRICTED',
      isDeleted: false,
    });

    if (!restrictedLeaveType) {
      console.log('📝 Creating RESTRICTED leave type...');
      restrictedLeaveType = await LeaveType.create({
        name: 'Restricted Leave',
        code: 'RESTRICTED',
        defaultQuota: 2,
        isCarryForward: false,
        isAccrued: false,
        defaultAccrualType: 'none',
        isDeleted: false,
      });
      console.log('✅ Created RESTRICTED leave type\n');
    } else {
      console.log('ℹ️ RESTRICTED leave type already exists\n');
    }

    // Step 2: Get all leave policies
    const allPolicies = await LeavePolicy.find({ isDeleted: false });
    console.log(`📋 Found ${allPolicies.length} leave policies\n`);

    if (allPolicies.length === 0) {
      console.log('⚠️ No leave policies found. Please create leave policies first.');
      return;
    }

    // Step 3: Add RESTRICTED leave type to all policies
    let mappingCreated = 0;
    let mappingSkipped = 0;

    for (const policy of allPolicies) {
      const existingMapping = await LeavePolicyMapping.findOne({
        leavePolicyId: policy._id,
        leaveTypeId: restrictedLeaveType._id,
        isDeleted: false,
      });

      if (existingMapping) {
        console.log(`ℹ️ RESTRICTED mapping already exists for policy: ${policy.name}`);
        mappingSkipped++;
      } else {
        await LeavePolicyMapping.create({
          leavePolicyId: policy._id,
          leaveTypeId: restrictedLeaveType._id,
          quota: 2, // Fixed quota of 2 restricted leaves per year
          accrualType: 'none', // No accrual, fixed quota
          accrualPerMonth: 0,
          maxCarryForward: 0,
          isDeleted: false,
        });
        console.log(`✅ Added RESTRICTED leave type to policy: ${policy.name}`);
        mappingCreated++;
      }
    }

    console.log(`\n📊 Policy Mapping Summary:`);
    console.log(`   - Mappings created: ${mappingCreated}`);
    console.log(`   - Mappings skipped (already exist): ${mappingSkipped}\n`);

    // Step 4: Get all users (regardless of status)
    const allUsers = await User.find({ isDeleted: false });
    console.log(`👥 Found ${allUsers.length} users to process\n`);

    if (allUsers.length === 0) {
      console.log('⚠️ No users found.');
      return;
    }

    // Step 5: Create EmployeeLeaveBalance for all users
    let balanceCreated = 0;
    let balanceSkipped = 0;
    let usersWithoutPolicy = 0;

    for (const user of allUsers) {
      // Skip users without leavePolicyId
      if (!user.leavePolicyId) {
        console.log(
          `⚠️ User ${user.employeeId || user.email} has no leave policy assigned - skipping`
        );
        usersWithoutPolicy++;
        continue;
      }

      // Check if user already has RESTRICTED leave balance
      const existingBalance = await EmployeeLeaveBalance.findOne({
        userId: user._id,
        leaveTypeId: restrictedLeaveType._id,
      });

      if (existingBalance) {
        console.log(
          `ℹ️ RESTRICTED balance already exists for user: ${
            user.employeeId || user.email
          }`
        );
        balanceSkipped++;
      } else {
        await EmployeeLeaveBalance.create({
          userId: user._id,
          leaveTypeId: restrictedLeaveType._id,
          accrued: 2, 
          used: 0,
          carryForwarded: 0,
          total: 2, 
        });
        console.log(
          `✅ Created RESTRICTED balance for user: ${
            user.employeeId || user.email
          } (${user.firstName} ${user.lastName})`
        );
        balanceCreated++;
      }
    }

    console.log(`\n📊 Employee Balance Summary:`);
    console.log(`   - Balances created: ${balanceCreated}`);
    console.log(`   - Balances skipped (already exist): ${balanceSkipped}`);
    console.log(`   - Users without policy: ${usersWithoutPolicy}\n`);

    console.log('🎉 Restricted Leave Setup Complete!\n');
    console.log('📋 Final Summary:');
    console.log(`   - Leave Type: ${restrictedLeaveType.name} (${restrictedLeaveType.code})`);
    console.log(`   - Policies processed: ${allPolicies.length}`);
    console.log(`   - Policy mappings created: ${mappingCreated}`);
    console.log(`   - Users processed: ${allUsers.length}`);
    console.log(`   - User balances created: ${balanceCreated}\n`);
  } catch (err) {
    console.error('❌ Error:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  addRestrictedLeaveToAllUsers()
    .then(() => {
      console.log('✨ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addRestrictedLeaveToAllUsers };


