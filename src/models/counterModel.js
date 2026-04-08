const mongoose = require('mongoose');
const { Schema } = mongoose;

const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

counterSchema.index({ key: 1 }, { unique: true });

const Counter = mongoose.model('Counter', counterSchema);

module.exports = Counter;

