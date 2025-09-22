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
      enum: ['tl-pending', 'hr-pending', 'tl-rejected', 'hr-rejected', 'approved', 'auto-rejected', 'revoked'],
      default: 'tl-pending',
    },
    isUnpaid: { type: Boolean, default: false },
    isHalfDay: { type: Boolean, default: false },
    halfDayType: { 
      type: String, 
      enum: ['first', 'second'],
      required: function() {
        return this.isHalfDay === true;
      }
    },
    isDeleted: { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    tlApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    tlRejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hrApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hrRejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    appliedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeaveApplication', leaveApplicationSchema);