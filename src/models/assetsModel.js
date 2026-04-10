const mongoose = require('mongoose');
const {
  VALID_ASSETS_STATUS,
  VALID_LAPTOP_TYPES,
  VALID_ASSET_ASSIGNMENT_TYPES,
} = require('../utility/constants');
const { Schema } = mongoose;

/** API output: when inventory is populated, these five fields come from inventory (single source). */
function mergeDisplayFieldsFromInventory(ret) {
  const inv = ret.inventoryAsset;
  if (!inv || typeof inv !== 'object') return;
  const hasInv = inv._id != null || inv.id != null;
  if (!hasInv) return;
  ret.assetType = inv.assetType ?? ret.assetType;
  ret.assetName = inv.assetName ?? ret.assetName;
  ret.serialNumber = inv.serialNumber ?? ret.serialNumber;
  if (inv.laptopType != null && inv.laptopType !== '') {
    ret.laptopType = inv.laptopType;
  }
  if (inv.specifications !== undefined && inv.specifications !== null) {
    ret.specifications = inv.specifications;
  }
}

const assignedAssetSchema = new Schema(
  {
    inventoryAsset: {
      type: Schema.Types.ObjectId,
      ref: 'AssetInventory',
      required: false,
    },
    assetType: {
      type: String,
      required: function () {
        return !this.inventoryAsset;
      },
      trim: true,
    },
    // assetId: {
    //   type: String,
    //   required: true,
    //   trim: true,
    // },
    assetName: {
      type: String,
      required: function () {
        return !this.inventoryAsset;
      },
    },
    serialNumber: {
      type: String,
      required: false,
    },
    laptopType: {
      type: String,
      required: function () {
        if (this.inventoryAsset) return false;
        return this.assetType === 'laptop';
      },
      validate: {
        validator: function (value) {
          if (this.inventoryAsset) return true;
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
    assignmentType: {
      type: String,
      enum: {
        values: VALID_ASSET_ASSIGNMENT_TYPES,
        message: 'Invalid assignment type: {VALUE}',
      },
      default: 'permanent',
      required: true,
    },
    temporaryUntil: {
      type: Date,
      required: function () {
        return this.assignmentType === 'temporary';
      },
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

assignedAssetSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    mergeDisplayFieldsFromInventory(ret);
    return ret;
  },
});

const Assets = mongoose.model('Assets', assignedAssetSchema);

module.exports = Assets;