const mongoose = require('mongoose');
const { Schema } = mongoose;

const wfhSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    wfhReason: {
      type: String,
      required: true,
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
wfhSchema.index({ userId: 1, date: 1 });

const Attendance = mongoose.model('WFH', wfhSchema);

module.exports = Attendance;
