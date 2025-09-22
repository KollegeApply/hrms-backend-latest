const mongoose = require('mongoose');
const { VALID_ASSETS_STATUS, VALID_LAPTOP_TYPES } = require('../utility/constants');
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
    laptopType: {
      type: String,
      required: function() {
        return this.assetType === 'laptop';
      },
      validate: {
        validator: function(value) {
          if (this.assetType === 'laptop') {
            return VALID_LAPTOP_TYPES.includes(value);
          }
          return value === '' || value === null || value === undefined;
        },
        message: 'Invalid laptop type: {VALUE}',
      },
      trim: true,
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
    rejectionReason: {
      type: String,
      maxlength: 1000,
      validate: {
        validator: function () {
          return this.status === 'not_acknowledged';
        },
        message: "Rejection reason can only be set if status is 'not_acknowledged'.",
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
  laptopType: 'text', 
});

const Assets = mongoose.model('Assets', assignedAssetSchema);

module.exports = Assets;