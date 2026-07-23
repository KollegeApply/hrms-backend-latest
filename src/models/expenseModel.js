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
    amount: { type: Number, required: true, min: 0.01 },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },
    attachmentUrl: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: [
        'draft',
        'submitted',
        'tl-approved',
        'tl-rejected',
        'expense-approved',
        'rejected',
      ],
      default: 'submitted',
    },
    tlId: { type: Schema.Types.ObjectId, ref: 'User' },
    tlRemark: { type: String, trim: true, maxlength: 500 },
    financeRemark: { type: String, trim: true, maxlength: 500 },
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

module.exports = mongoose.model('Expense', expenseSchema);
