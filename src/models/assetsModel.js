const mongoose = require('mongoose');
const { VALID_ASSETS_STATUS } = require('../utility/constants');
const { Schema } = mongoose;

const assignedAssetSchema = new Schema(
  {
    assetType: {
      type: String,
      required:true,
      trim:true,
    },
    // assetId: {
    //   type: String,
    //   required: true,
    //   trim: true,
    // },
    assetName: {
      type: String,
      required: true,
    },
    serialNumber: {
      type: String,
      required: false,
    },
    specifications: {
      type: Schema.Types.Mixed,
      required: false,
    },
    assignee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    status: {
      type: String,
      enum: {
        values: VALID_ASSETS_STATUS,
        message: 'Invalid asset status: {VALUE}',
      },
      default: VALID_ASSETS_STATUS.ASSIGNED,
      required: true,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    acknowledgedDate: {
      type: Date,
      validate: {
        validator: function () {
          return this.status === 'acknowledged';
        },
        message: "Acknowledged date can only be set if status is 'acknowledged'.",
      },
    },
    returnRequestDate:{
      type: Date,
      validate: {
        validator: function () {
          return this.status === 'acknowledged';
        },
        message: "Return request date can only be set if status is 'acknowledged'.",
      },  
    },
    returnDate: {
      type: Date,
      validate: {
        validator: function () {
          return this.status === 'returned';
        },
        message: "Return date can only be set if status is 'returned'.",
      },
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

assignedAssetSchema.index({
  assetName: 'text',
  assetType: 'text',
  serialNumber: 'text',
});

const Assets = mongoose.model('Assets', assignedAssetSchema);

module.exports = Assets;