const mongoose = require('mongoose');
const { Schema } = mongoose;

const attendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    checkInTime: {
      type: Date,
    },
    checkOutTime: {
      type: Date,
    },
    checkInLocation: {
      latitude: Number,
      longitude: Number,
    },
    checkOutLocation: {
      latitude: Number,
      longitude: Number,
    },
    status: {
      type: String,
      enum: ['present', 'leave_applied', 'wfh_applied'],
      default: 'present',
    },
    leaveId: {
      type: Schema.Types.ObjectId,
      ref: 'Leaves',
    },
    wfhId: {
      type: Schema.Types.ObjectId,
      ref: 'WFH',
    },
    // leaveReason: {
    //   type: String,
    // },
    // wfhReason: {
    //   type: String,
    // },
    checkInMode: {
      type: String,
      enum: ['on-site', 'off-site'],
    },
    checkOutMode: {
      type: String,
      enum: ['on-site', 'off-site'],
    },
    date: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster querying of attendance by user and date
attendanceSchema.index({ user: 1, date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
