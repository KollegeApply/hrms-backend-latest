const mongoose = require('mongoose');
const { Schema } = mongoose;

const leavePolicyMappingSchema = new Schema(
  {
    leavePolicyId: {
      type: Schema.Types.ObjectId,
      ref: 'LeavePolicy',
      required: true,
    },
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
    },
    quota: { type: Number, required: true },
    accrualType: {
      type: String,
      enum: ['monthly', 'yearly', 'none'],
      default: 'none',
    },
    accrualPerMonth: { type: Number, default: 0 },
    maxCarryForward: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeavePolicyMapping', leavePolicyMappingSchema);
