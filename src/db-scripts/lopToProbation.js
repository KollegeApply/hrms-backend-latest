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

async function addLOPToProbationPolicy() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const probationPolicy = await LeavePolicy.findOne({ name: 'Probation Policy' });
    const lopLeaveType = await LeaveType.findOne({ code: 'LOP' });

    if (!probationPolicy || !lopLeaveType) {
      throw new Error('Policy or LOP leave type not found');
    }

    const existingMapping = await LeavePolicyMapping.findOne({
      leavePolicyId: probationPolicy._id,
      leaveTypeId: lopLeaveType._id,
      isDeleted: false,
    });

    if (existingMapping) {
      console.log('ℹ️ LOP mapping already exists for Probation Policy');
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

    // Create LOP balance documents for existing probation users
    const probationUsers = await User.find({
      status: 'probation',
      leavePolicyId: probationPolicy._id
    });

    console.log(`📋 Found ${probationUsers.length} probation users to update`);

    for (const user of probationUsers) {
      // Check if user already has LOP balance
      const existingBalance = await EmployeeLeaveBalance.findOne({
        userId: user._id,
        leaveTypeId: lopLeaveType._id
      });

      if (!existingBalance) {
        await EmployeeLeaveBalance.create({
          userId: user._id,
          leaveTypeId: lopLeaveType._id,
          accrued: 0,
          used: 0,
          carryForwarded: 0,
          total: 0,
        });
        console.log(`✅ Created LOP balance for user: ${user.employeeId}`);
      } else {
        console.log(`ℹ️ LOP balance already exists for user: ${user.employeeId}`);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

addLOPToProbationPolicy();