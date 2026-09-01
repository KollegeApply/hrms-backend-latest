const mongoose = require('mongoose');
const {
  VALID_LAPTOP_TYPES,
  VALID_ASSET_CATEGORIES,
  VALID_ASSET_CONDITIONS,
  VALID_ASSET_INVENTORY_STATUS,
} = require('../utility/constants');

const { Schema } = mongoose;

const assetInventorySchema = new Schema(
  {
    assetId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    assetType: {
      type: String,
      required: true,
      trim: true,
    },
    laptopType: {
      type: String,
      required: function () {
        return this.assetType?.toLowerCase() === 'laptop';
      },
      validate: {
        validator: function (value) {
          if (this.assetType?.toLowerCase() === 'laptop') {
            return VALID_LAPTOP_TYPES.includes(value);
          }
          return value === '' || value === null || value === undefined;
        },
        message: 'Invalid laptop type: {VALUE}',
      },
      trim: true,
    },
    assetCategory: {
      type: String,
      enum: {
        values: VALID_ASSET_CATEGORIES,
        message: 'Invalid asset category: {VALUE}',
      },
      required: false,
      trim: true,
    },
    assetName: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      required: true,
      trim: true,
    },
    model: {
      type: String,
      required: false,
      trim: true,
    },
    serialNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    condition: {
      type: String,
      enum: {
        values: VALID_ASSET_CONDITIONS,
        message: 'Invalid asset condition: {VALUE}',
      },
      required: true,
    },
    specifications: {
      type: String,
      required: false,
      trim: true,
    },
    purchaseDate: {
      type: Date,
      required: false,
    },
    status: {
      type: String,
      enum: {
        values: VALID_ASSET_INVENTORY_STATUS,
        message: 'Invalid asset status: {VALUE}',
      },
      default: 'available',
      required: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    notes: {
      type: String,
      required: false,
      trim: true,
      maxlength: 2000,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

assetInventorySchema.index({
  assetId: 'text',
  assetType: 'text',
  assetName: 'text',
  brand: 'text',
  model: 'text',
  serialNumber: 'text',
});
assetInventorySchema.index({ status: 1 });
assetInventorySchema.index({ assetType: 1 });
assetInventorySchema.index({ assignedTo: 1 });

const AssetInventory = mongoose.model('AssetInventory', assetInventorySchema);

module.exports = AssetInventory;

