const User = require('../models/userModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const { default: mongoose } = require('mongoose');

async function accrueLeavesForAllEmployees() {
  const year = new Date().getFullYear();
  const users = await User.find({ isDeleted: false });
  for (const user of users) {
    if (!user.leavePolicyId) continue;
    const mappings = await LeavePolicyMapping.find({
      leavePolicyId: user.leavePolicyId,
    });
    for (const mapping of mappings) {
      if (mapping.accrualType === 'monthly') {
        let balance = await EmployeeLeaveBalance.findOne({
          employeeId: user._id,
          leaveTypeId: mapping.leaveTypeId,
          year,
        });
        if (!balance) {
          balance = await EmployeeLeaveBalance.create({
            employeeId: user._id,
            leaveTypeId: mapping.leaveTypeId,
            year,
            accrued: 0,
            used: 0,
            carryForwarded: 0,
          });
        }
        balance.accrued += mapping.accrualPerMonth;
        balance.updatedAt = new Date();
        await balance.save();
      }
      // Add logic for yearly accrual if needed
    }
  }
  console.log('✅ Monthly leave accrual complete!');
}

if (require.main === module) {
  accrueLeavesForAllEmployees().then(() => mongoose.disconnect());
}

module.exports = accrueLeavesForAllEmployees;
