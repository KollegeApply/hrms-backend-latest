const mongoose = require('mongoose');
const { Schema } = mongoose;

const EvidenceSchema = new Schema({
  url: { type: String },
}, { _id: false });

const RegularizationSchema = new Schema({
  type: {
    type: String,
    enum: ['standard', 'emergency'],
    required: true,
  },
  reason: { type: String, required: true },
  requestedCheckInTime: { type: Date },
  requestedCheckOutTime: { type: Date },

  evidence: {
    type: EvidenceSchema,
    required: function () { return this.type === 'emergency'; }
  },

  status: {
    type: String,
    enum: [
      'tl-pending',
      'tl-rejected',
      'hr-pending',
      'approved',
      'hr-rejected'
    ],
    default: 'tl-pending'
  },

  // Team Lead review
  tl: {
    reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String, enum: ['approved', 'rejected', null], default: null },
    comment: String,
    decidedAt: Date
  },

  // HR review
  hr: {
    reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
    decision: { type: String, enum: ['approved', 'rejected', null], default: null },
    comment: String,
    decidedAt: Date
  },

  appliedAt: { type: Date, default: Date.now },
  appliedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: false });

const attendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    checkInTime: Date,
    checkOutTime: Date,

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
      enum: ['present', 'absent', 'late_in', 'early_out','late_in_early_out', 'leave_applied_first_half',
        'leave_applied_second_half',
        'leave_applied_full', 'wfh_applied'],
    },

    leaveId: {
      type: Schema.Types.ObjectId,
      ref: 'LeaveApplication',
    },
    wfhId: {
      type: Schema.Types.ObjectId,
      ref: 'WFH',
    },

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

    regularization: { type: RegularizationSchema }
  },
  {
    timestamps: true,
  }
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ 'regularization.status': 1, 'regularization.appliedAt': 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
