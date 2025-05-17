const mongoose = require('mongoose');
const { REQUEST_TYPES } = require('../utility/constants');
const { BACKDATED_REQUEST_TYPES} = require('../utility/constants');
const { Schema } = mongoose;

const backDatedCheckInSchema = new Schema( 
  {
    backdatedCheckInType: {
      type: String,
      enum: [BACKDATED_REQUEST_TYPES.full, BACKDATED_REQUEST_TYPES.half],
      default: BACKDATED_REQUEST_TYPES.full
    },
    date: {       // Date of Check In
      type: Date,
      required: true
    },
  }
);

const requestSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestType: {
      type: String,
      enum: {
        values: Object.values(REQUEST_TYPES),
        message: 'Invalid request type: {VALUE}',
      },
      default: REQUEST_TYPES.backDatedCheckIn,
      required: true,
    },
    backDatedCheckIn: {
      type: backDatedCheckInSchema,
      required: false
    },
    requestDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500,
    },
    reviewedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['approved', 'pending', 'rejected'],
      default: 'pending',
      required: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

// requestSchema.index({ userId: 1, reviewedAt: 1 });

const Request = mongoose.model('Request', requestSchema);

module.exports = Request;