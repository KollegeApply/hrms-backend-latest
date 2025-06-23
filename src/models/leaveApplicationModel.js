const mongoose = require('mongoose');
const { Schema } = mongoose;

const leaveApplicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leaveTypeId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveType',
      required: true,
    },
    dates: { type: [Date], required: true },
    totalDays: { type: Number, required: true },
    leaveReason: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'auto-rejected', 'revoked'],
      default: 'pending',
    },
    isUnpaid: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    appliedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeaveApplication', leaveApplicationSchema);
