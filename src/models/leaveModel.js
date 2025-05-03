const mongoose = require('mongoose');
const { Schema } = mongoose;

const leaveSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    leaveReason: {
      type: String,
      required: true,
    },
    leaveType: {
      type: String,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['approved', 'pending', 'rejected', 'revoked'],
      default: 'pending',
      required: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster querying of attendance by user and date
leaveSchema.index({ userId: 1, date: 1 });

const Leave = mongoose.model('Leaves', leaveSchema);

module.exports = Leave;
