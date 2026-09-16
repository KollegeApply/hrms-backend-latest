const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Singleton settings doc (single row, key: 'global') controlling whether
 * employees can submit new expenses — FR-1.1 / FR-1.2.
 */
const expenseFilingCutoffSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    /** true = filing is currently BLOCKED (the cutoff is in effect). */
    cutoffActive: { type: Boolean, default: false },
    scope: { type: String, enum: ['all', 'departments'], default: 'all' },
    /** Only meaningful when scope === 'departments'. */
    departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
    message: { type: String, trim: true, maxlength: 300 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Full audit trail — every change, not just the latest state. */
    history: [
      {
        cutoffActive: { type: Boolean, required: true },
        scope: { type: String, enum: ['all', 'departments'], required: true },
        departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
        message: { type: String, trim: true, maxlength: 300 },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('ExpenseFilingCutoff', expenseFilingCutoffSchema);
