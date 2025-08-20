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
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

addLOPToProbationPolicy();
