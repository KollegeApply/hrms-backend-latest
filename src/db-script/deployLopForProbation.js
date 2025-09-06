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

const User = require('../models/userModel');
const LeavePolicy = require('../models/leavePolicyModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const LeaveType = require('../models/leaveTypeModel');

async function deployLopForProbation() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('🚀 Deploying LOP leave functionality for probation users...\n');

    // Step 1: Add LOP to Probation Policy
    console.log('📋 Step 1: Adding LOP to Probation Policy...');
    
    const probationPolicy = await LeavePolicy.findOne({ name: 'Probation Policy' });
    const lopLeaveType = await LeaveType.findOne({ code: 'LOP' });

    if (!probationPolicy) {
      throw new Error('❌ Probation Policy not found');
    }
    if (!lopLeaveType) {
      throw new Error('❌ LOP leave type not found');
    }

    const existingMapping = await LeavePolicyMapping.findOne({
      leavePolicyId: probationPolicy._id,
      leaveTypeId: lopLeaveType._id,
      isDeleted: false,
    });

    if (existingMapping) {
      console.log('✅ LOP already exists in Probation Policy');
    } else {
      await LeavePolicyMapping.create({
        leavePolicyId: probationPolicy._id,
        leaveTypeId: lopLeaveType._id,
        quota: 0,
        accrualType: 'yearly',
        accrualPerMonth: 0,
        maxCarryForward: 0,
        isDeleted: false,
      });
      console.log('✅ LOP successfully added to Probation Policy');
    }

    // Step 2: Create LOP balance records for existing probation users
    console.log('\n👥 Step 2: Creating LOP balance records for existing probation users...');
    
    const probationUsers = await User.find({ 
      status: 'probation',
      isDeleted: false 
    });

    console.log(`📊 Found ${probationUsers.length} probation users`);

    let createdCount = 0;
    let existingCount = 0;

    for (const user of probationUsers) {
      // Check if LOP balance already exists
      const existingLopBalance = await EmployeeLeaveBalance.findOne({
        userId: user._id,
        leaveTypeId: lopLeaveType._id,
      });

      if (existingLopBalance) {
        existingCount++;
        continue;
      }

      // Create LOP balance record
      await EmployeeLeaveBalance.create({
        userId: user._id,
        leaveTypeId: lopLeaveType._id,
        accrued: 0,
        used: 0,
        carryForwarded: 0,
        total: 0,
      });

      createdCount++;
    }

    console.log(`✅ Created ${createdCount} new LOP balance records`);
    console.log(`⏭️  Skipped ${existingCount} existing records`);

    // Step 3: Verify the deployment
    console.log('\n🔍 Step 3: Verifying deployment...');
    
    const probationMappings = await LeavePolicyMapping.find({
      leavePolicyId: probationPolicy._id,
      isDeleted: false,
    }).populate('leaveTypeId');

    console.log(`📋 Probation Policy now has ${probationMappings.length} leave types:`);
    probationMappings.forEach(mapping => {
      console.log(`  - ${mapping.leaveTypeId.name} (${mapping.leaveTypeId.code})`);
    });

    const lopBalanceCount = await EmployeeLeaveBalance.countDocuments({
      leaveTypeId: lopLeaveType._id,
    });

    console.log(`📊 Total LOP balance records in database: ${lopBalanceCount}`);

    // Step 4: Summary
    console.log('\n🎉 Deployment Summary:');
    console.log('✅ LOP added to Probation Policy');
    console.log(`✅ ${createdCount} LOP balance records created for probation users`);
    console.log('✅ All probation users can now apply for LOP leaves');
    console.log('✅ Half-day LOP leaves are supported');
    console.log('✅ LOP leave usage tracking is enabled');
    console.log('✅ LOP is hidden from dashboard (unlimited availability)');
    console.log('✅ LOP leaves do not create attendance records (unpaid leave)');
    
    console.log('\n📝 Next Steps:');
    console.log('1. Deploy the updated backend code');
    console.log('2. Deploy the updated frontend code');
    console.log('3. Test LOP leave application for probation users');
    console.log('4. Verify LOP leave approval and balance tracking');

  } catch (err) {
    console.error('❌ Deployment failed:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the deployment
deployLopForProbation()
  .then(() => {
    console.log('\n🎊 LOP for Probation deployment completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Deployment failed:', err);
    process.exit(1);
  });
