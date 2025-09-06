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

async function rollbackLopForProbation() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('🔄 Rolling back LOP leave functionality for probation users...\n');

    // Step 1: Remove LOP from Probation Policy
    console.log('📋 Step 1: Removing LOP from Probation Policy...');
    
    const probationPolicy = await LeavePolicy.findOne({ name: 'Probation Policy' });
    const lopLeaveType = await LeaveType.findOne({ code: 'LOP' });

    if (!probationPolicy || !lopLeaveType) {
      console.log('⚠️  Probation Policy or LOP leave type not found - nothing to rollback');
      return;
    }

    const lopMapping = await LeavePolicyMapping.findOne({
      leavePolicyId: probationPolicy._id,
      leaveTypeId: lopLeaveType._id,
      isDeleted: false,
    });

    if (lopMapping) {
      lopMapping.isDeleted = true;
      await lopMapping.save();
      console.log('✅ LOP removed from Probation Policy');
    } else {
      console.log('✅ LOP was not in Probation Policy');
    }

    // Step 2: Remove LOP balance records for probation users
    console.log('\n👥 Step 2: Removing LOP balance records for probation users...');
    
    const probationUsers = await User.find({ 
      status: 'probation',
      isDeleted: false 
    });

    const probationUserIds = probationUsers.map(user => user._id);

    const deletedBalances = await EmployeeLeaveBalance.deleteMany({
      userId: { $in: probationUserIds },
      leaveTypeId: lopLeaveType._id,
    });

    console.log(`✅ Deleted ${deletedBalances.deletedCount} LOP balance records for probation users`);

    // Step 3: Verify the rollback
    console.log('\n🔍 Step 3: Verifying rollback...');
    
    const probationMappings = await LeavePolicyMapping.find({
      leavePolicyId: probationPolicy._id,
      isDeleted: false,
    }).populate('leaveTypeId');

    console.log(`📋 Probation Policy now has ${probationMappings.length} leave types:`);
    probationMappings.forEach(mapping => {
      console.log(`  - ${mapping.leaveTypeId.name} (${mapping.leaveTypeId.code})`);
    });

    const remainingLopBalances = await EmployeeLeaveBalance.countDocuments({
      leaveTypeId: lopLeaveType._id,
    });

    console.log(`📊 Remaining LOP balance records in database: ${remainingLopBalances}`);

    // Step 4: Summary
    console.log('\n🎉 Rollback Summary:');
    console.log('✅ LOP removed from Probation Policy');
    console.log(`✅ ${deletedBalances.deletedCount} LOP balance records deleted for probation users`);
    console.log('✅ Probation users can no longer apply for LOP leaves');
    console.log('✅ System reverted to previous state');
    
    console.log('\n📝 Next Steps:');
    console.log('1. Deploy the previous version of backend code');
    console.log('2. Deploy the previous version of frontend code');
    console.log('3. Verify probation users can only apply for probation leaves');

  } catch (err) {
    console.error('❌ Rollback failed:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the rollback
rollbackLopForProbation()
  .then(() => {
    console.log('\n🎊 LOP for Probation rollback completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Rollback failed:', err);
    process.exit(1);
  });
