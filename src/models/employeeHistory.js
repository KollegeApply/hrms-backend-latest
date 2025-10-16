const mongoose = require('mongoose');

const employeeHistorySchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    entity: {
      type: String,
      required: true, // e.g., 'department', 'position', 'status'
    },
    previous: mongoose.Schema.Types.Mixed,
    changed: mongoose.Schema.Types.Mixed,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actionAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmployeeHistory', employeeHistorySchema);
