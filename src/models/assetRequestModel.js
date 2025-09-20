const mongoose = require('mongoose');
const { Schema } = mongoose;

const assetRequestSchema = new Schema(
  {
    assetType: {
      type: String,
      required: true,
      trim: true,
    },
    specifications: {
      type: String,
      required: true,
      trim: true,
    },
    neededBy: {
      type: Date,
      required: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ["asset-request-pending", "asset-request-approved", "asset-request-rejected"],
      default: 'asset-request-pending',
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    approvedDate: {
      type: Date,
      required: false,
    },
    rejectionReason: {
      type: String,
      required: false,
    },
    fulfilledDate: {
      type: Date,
      required: false,
    },
    assignedAsset: {
      type: Schema.Types.ObjectId,
      ref: 'Assets',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

assetRequestSchema.index({
  assetType: 'text',
  specifications: 'text',
  description: 'text',
});

const AssetRequest = mongoose.model('AssetRequest', assetRequestSchema);

module.exports = AssetRequest;
