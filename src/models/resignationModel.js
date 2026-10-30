const mongoose = require('mongoose');
const { Schema } = mongoose;

const RESIGNATION_STATUS = {
  TL_PENDING: 'tl-pending',
  TL_REJECTED: 'tl-rejected',
  TL_APPROVED: 'tl-approved',
  HR_REJECTED: 'hr-rejected',
  RESIGNED: 'resigned',
};

const resignationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    team: { type: String, required: true },
    emailSubject: { type: String, required: true, trim: true },
    to: { type: [String], required: true },
    cc: { type: [String], default: [] },
    emailBody: { type: String, required: true },
    // Date the employee asked for
    requestedLastWorkingDay: { type: Date, required: true },
    // Final date; set by the TL when approving
    lastWorkingDay: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(RESIGNATION_STATUS),
      default: RESIGNATION_STATUS.TL_PENDING,
      required: true,
    },
    emailSent: { type: Boolean, default: false },
    // Message-ID of the original mail; later updates reply to it (same thread).
    mailMessageId: { type: String },
    tlActionBy: { type: Schema.Types.ObjectId, ref: 'User' },
    tlActionAt: { type: Date },
    hrActionBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hrActionAt: { type: Date },
  },
  { timestamps: true }
);

resignationSchema.index({ userId: 1, status: 1 });
resignationSchema.index({ status: 1, createdAt: -1 });

const Resignation = mongoose.model('Resignation', resignationSchema);

module.exports = Resignation;
module.exports.RESIGNATION_STATUS = RESIGNATION_STATUS;
