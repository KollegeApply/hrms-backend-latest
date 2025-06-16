const mongoose = require('mongoose');
const { Schema } = mongoose;

const employeeLeaveBalanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
    },
    accrued: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    carryForwarded: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'EmployeeLeaveBalance',
  employeeLeaveBalanceSchema
);
