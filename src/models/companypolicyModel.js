const mongoose = require('mongoose');
const { Schema } = mongoose;

const companyPolicySchema = new mongoose.Schema(
  {
    policyType: {
      type: String,
      enum: ['BYOD', 'NDA'],
      required: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: ['PENDING', 'SUBMITTED'],
      default: 'PENDING',
    },

    effectiveDate: {
      type: Date,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CompanyPolicy', companyPolicySchema);
