const AssetInventory = require('../models/assetInventoryModel');
const Counter = require('../models/counterModel');
const User = require('../models/userModel');
const logger = require('../config/logger');
const { paginate } = require('../utility/common');

function formatAssetId(seq) {
  const padded = String(seq).padStart(3, '0');
  return `AST${padded}`;
}

async function getNextAssetId() {
  const counter = await Counter.findOneAndUpdate(
    { key: 'asset_inventory_ast' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return formatAssetId(counter.seq);
}

class AssetInventoryService {
  async createAsset(payload) {
    const assetId = await getNextAssetId();

    const doc = new AssetInventory({
      ...payload,
      assetId,
    });

    await doc.save();
    logger.info(`Asset inventory created: ${assetId}`);
    return doc;
  }

  async listAssets({ page, limit, search, assetType, status, departmentId }) {
    const query = { isDeleted: false };

    if (assetType) {
      query.assetType = assetType;
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$text = { $search: search };
    }

    if (departmentId) {
      const userIds = await User.find({ department: departmentId })
        .select('_id')
        .lean();
      query.assignedTo = { $in: userIds.map((u) => u._id) };
    }

    return paginate(
      AssetInventory,
      query,
      page,
      limit,
      { createdAt: -1 },
      null,
      [
        { path: 'assignedTo', select: 'firstName lastName employeeId email department team' },
      ]
    );
  }

  async getById(id) {
    const doc = await AssetInventory.findOne({ _id: id, isDeleted: false }).populate(
      'assignedTo',
      'firstName lastName employeeId email department team'
    );
    if (!doc) throw new Error('Asset not found');
    return doc;
  }
}

module.exports = new AssetInventoryService();

