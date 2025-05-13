const mongoose = require('mongoose');
const { Schema } = mongoose;

const requestSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestType: {
      type: String,
      enum: ["retroactive-check-in", "ticket"],
      required: true,
    },
    requestDescription: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000,
    },
    reviewedAt: {
      type: Date,
      required: false,
    },
    status: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'pending',
      required: true,
    },
    reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

requestSchema.index({ userId: 1, reviewedDate: 1 });

const Request = mongoose.model('Request', requestSchema);

module.exports = Request;