const mongoose = require('mongoose');
const { Schema } = mongoose;

const leavePolicySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeavePolicy', leavePolicySchema);
