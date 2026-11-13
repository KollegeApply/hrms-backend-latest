const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Monthly out-of-station travel mandate status per employee (Travel Policy,
 * Nov 2026). When `completed` is true for a month, the conditional add-on
 * (Rs.4,000 AM / Rs.6,000 TL & ZH) is released for out-of-station local
 * commute claims over and above the Rs.10,000 base-location cap. It is
 * all-or-nothing and never carries forward, hence one row per user-month.
 */
const expenseOutstationMandateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    completed: { type: Boolean, default: false },
    remark: { type: String, trim: true, maxlength: 300 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

expenseOutstationMandateSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model(
  'ExpenseOutstationMandate',
  expenseOutstationMandateSchema
);
