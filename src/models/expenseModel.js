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
      enum: ['Travel', 'Food', 'Stay', 'Miscellaneous'],
    },
    miscellaneousType: { type: String, trim: true, maxlength: 20 },
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
        'finance-approved',
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

module.exports = mongoose.model('Expense', expenseSchema);
