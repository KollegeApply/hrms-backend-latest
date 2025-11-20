const mongoose = require('mongoose');
const { Schema } = mongoose;

const biometricLogSchema = new Schema(
  {
    employeeCode: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    downloadDate: {
      type: Date,
      required: true,
    },
    logDate: {
      type: Date,
      required: true,
      index: true,
    },
    deviceName: {
      type: String,
      required: true,
      trim: true,
    },
    serialNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    direction: {
      type: String,
      // enum: ['IN', 'OUT'], // Commented out temporarily
      required: true,
    },
    deviceDirection: {
      type: String,
      required: true,
      trim: true,
    },
    workCode: {
      type: String,
      default: '0',
      trim: true,
    },
    verificationType: {
      type: String,
      // enum: ['Finger', 'Face', 'Card', 'Password'], // Commented out temporarily
      required: true,
    },
    gps: {
      type: String,
      default: '0,0',
    },
    // Reference to User if employeeCode matches
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Raw payload for debugging
    // rawPayload: {
    //   type: Schema.Types.Mixed,
    // },
    // Flag to indicate if data was encrypted
    wasEncrypted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
biometricLogSchema.index({ employeeCode: 1, logDate: 1 });
biometricLogSchema.index({ logDate: -1 });
biometricLogSchema.index({ serialNumber: 1, logDate: -1 });

const BiometricLog = mongoose.model('BiometricLog', biometricLogSchema);

module.exports = BiometricLog;

