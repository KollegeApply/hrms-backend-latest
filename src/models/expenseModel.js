const mongoose = require('mongoose');
const { Schema } = mongoose;

const expenseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    team: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: {
      type: String,
      required: true,
      enum: [
        'Travel',
        'Food',
        'Stay',
        'Miscellaneous',
        'Mobile Bill',
        'Technical Tools',
        'Team Lunch',
      ],
    },
    /** Phase 2 — sub-type under Travel / Food / Miscellaneous. */
    subCategory: { type: String, trim: true, maxlength: 120 },
    /** Legacy Phase 1 — free-text miscellaneous; kept for older rows. */
    miscellaneousType: { type: String, trim: true, maxlength: 200 },
    distanceKm: { type: Number, min: 0 },
    clientName: { type: String, trim: true, maxlength: 100 },
    clientPocName: { type: String, trim: true, maxlength: 100 },
    clientPocDesignation: { type: String, trim: true, maxlength: 100 },
    attendeeUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    miscOthersDescription: { type: String, trim: true, maxlength: 300 },
    travelMiscDescription: { type: String, trim: true, maxlength: 200 },
    /** Miscellaneous > Hotel Accommodation — Metro vs Non-Metro nightly cap (PRD). */
    cityTier: {
      type: String,
      enum: ['Metro', 'Non-Metro'],
    },
    /** Travel — manually entered college/lead code for the meeting visited. */
    kappId: { type: String, trim: true, maxlength: 50 },
    /** Travel — manually entered institute name for the meeting visited. */
    instituteName: { type: String, trim: true, maxlength: 200 },
    /** Travel — Base location (Intracity) vs Outstation (Intercity). */
    tripContext: {
      type: String,
      enum: ['Base location (Intracity)', 'Outstation (Intercity)'],
    },
    amount: { type: Number, required: true, min: 0.01 },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },
    attachmentUrl: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: [
        'submitted',
        'tl-approved',
        'tl-rejected',
        'admin-approved',
        'expense-rejected',
        'expense-returned',
        'expense-approved',
      ],
      default: 'submitted',
    },
    tlId: { type: Schema.Types.ObjectId, ref: 'User' },
    tlRemark: { type: String, trim: true, maxlength: 500 },
    expenseRemark: { type: String, trim: true, maxlength: 500 },
    /** Finance Department's latest remark (approve or return). */
    financeRemark: { type: String, trim: true, maxlength: 500 },
    /** Full audit trail of every approval-workflow action on this expense. */
    approvalHistory: [
      {
        action: { type: String, required: true },
        byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
        remark: { type: String, trim: true, maxlength: 500 },
        stage: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

expenseSchema.index(
  { userId: 1, date: 1, type: 1, amount: 1 },
  { partialFilterExpression: { isDeleted: { $ne: true } } }
);
expenseSchema.index({ team: 1, status: 1, createdAt: -1 });
expenseSchema.index(
  { team: 1, date: 1, type: 1 },
  { partialFilterExpression: { isDeleted: { $ne: true }, type: 'Team Lunch' } }
);
/** Dashboard: month/year + team/status filters on non-deleted expenses. */
expenseSchema.index(
  { date: 1, team: 1, status: 1, userId: 1 },
  { partialFilterExpression: { isDeleted: { $ne: true } } }
);
/** Dashboard: employee-scoped monthly rollups. */
expenseSchema.index(
  { userId: 1, date: 1, status: 1 },
  { partialFilterExpression: { isDeleted: { $ne: true } } }
);
/**
 * Travel duplicate guard — same date + same KAPP ID, across ALL users
 * (not just the submitter's own claims). Base location (Intracity) only —
 * Outstation (Intercity) trips are exempt (e.g. a multi-day outstation
 * visit can reuse the same KAPP ID). A DB-level unique index (rather than
 * only an app-level check) so concurrent requests from different users
 * can't race past the findOne-then-create check.
 */
expenseSchema.index(
  { date: 1, kappId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: { $ne: true },
      type: 'Travel',
      tripContext: 'Base location (Intracity)',
      kappId: { $type: 'string' },
    },
  }
);

module.exports = mongoose.model('Expense', expenseSchema);
