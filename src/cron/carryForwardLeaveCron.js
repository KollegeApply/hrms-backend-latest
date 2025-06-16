const User = require('../models/userModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const { default: mongoose } = require('mongoose');

async function carryForwardLeavesForAllEmployees() {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  const users = await User.find({ isDeleted: false });
  for (const user of users) {
    if (!user.leavePolicyId) continue;
    const mappings = await LeavePolicyMapping.find({
      leavePolicyId: user.leavePolicyId,
    });
    for (const mapping of mappings) {
      if (mapping.maxCarryForward > 0) {
        const prevBalance = await EmployeeLeaveBalance.findOne({
          employeeId: user._id,
          leaveTypeId: mapping.leaveTypeId,
          year: previousYear,
        });
        if (!prevBalance) continue;
        const unused = Math.max(
          prevBalance.accrued + prevBalance.carryForwarded - prevBalance.used,
          0
        );
        const carryForwarded = Math.min(unused, mapping.maxCarryForward);
        let currBalance = await EmployeeLeaveBalance.findOne({
          employeeId: user._id,
          leaveTypeId: mapping.leaveTypeId,
          year: currentYear,
        });
        if (!currBalance) {
          currBalance = await EmployeeLeaveBalance.create({
            employeeId: user._id,
            leaveTypeId: mapping.leaveTypeId,
            year: currentYear,
            accrued: 0,
            used: 0,
            carryForwarded,
          });
        } else {
          currBalance.carryForwarded = carryForwarded;
          await currBalance.save();
        }
      }
    }
  }
  console.log('✅ Year-end carry forward complete!');
}

if (require.main === module) {
  carryForwardLeavesForAllEmployees().then(() => mongoose.disconnect());
}

module.exports = carryForwardLeavesForAllEmployees;
