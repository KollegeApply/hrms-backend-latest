const mongoose = require('mongoose');
const { Schema } = mongoose;

const leaveTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    defaultQuota: {
      type: Number,
      required: true,
    },
    isCarryForward: {
      type: Boolean,
      default: false,
    },
    isAccrued: {
      type: Boolean,
      default: false,
    },
    defaultAccrualType: {
      type: String,
      enum: ['monthly', 'yearly', 'none'],
      default: 'none',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeaveType', leaveTypeSchema);
