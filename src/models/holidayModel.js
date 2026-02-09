const { required, boolean } = require('joi');
const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isDeleted: {
      type: Boolean,
      required: true,
      default: false,
    },
    holidayType: {
      type: String,
      enum: ["Restricted", "Normal"],
      required: true,
      default: "Normal",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Holiday', holidaySchema);
