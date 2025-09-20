const mongoose = require('mongoose');

const personalEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    eventType: {
      type: String,
      enum: ['appointment', 'personal', 'friends', 'other'],
      default: 'personal',
    },
    color: {
      type: String,
      default: 'bg-blue-300',
    },
    isAllDay: {
      type: Boolean,
      default: true,
    },
    startTime: {
      type: String, // Format: "HH:MM"
    },
    endTime: {
      type: String, // Format: "HH:MM"
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
personalEventSchema.index({ userId: 1, date: 1 });
personalEventSchema.index({ userId: 1, isDeleted: 1 });

module.exports = mongoose.model('PersonalEvent', personalEventSchema);
