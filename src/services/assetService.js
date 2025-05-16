const User = require('../models/userModel');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const Assets = require('../models/assetsModel'); // Corrected model name
const { paginate } = require('../utility/common');

class AssetsService {
  /**
   * Assigns an asset to an employee and sends an email notification.
   * @param {object} assignmentData - Data for the asset assignment.
   * @returns {Promise<AssignedAsset>} - The newly created assigned asset record.
   */
  async assignAsset(assignmentData) {
    const {
      assetId,
      assetName,
      assignee,
      serialNo,
      specifications,
      status = 'assigned',
      assignedBy,
    } = assignmentData;

    // Validate the asset ID
    const asset = await Assets.findOne({ assetId });
    if (asset) {
      logger.error('Asset is already assigned', assetId);
      throw new Error('Asset is already assigned');
    }

    // Validate the assignee
    const user = await User.findById(assignee);
    if (!user) {
      logger.error('User not found', assignee);
      throw new Error('User not found');
    }

    // Validate the assignedBy
    const assignedByUser = await User.findById(assignedBy);
    if (!assignedByUser) {
      logger.error('Assigned by user not found', assignedBy);
      throw new Error('Assigned by user not found');
    }

    const newAssignment = new Assets({
      assetId,
      assetName,
      assignee,
      serialNo,
      specifications,
      status: status,
      assignedBy,
    });
    await newAssignment.save();
    logger.info('Asset assigned successfully:', newAssignment);
    return newAssignment;
  }

  /**
   * Fetches all assigned assets.
   * @returns {Promise<AssignedAsset[]>} - List of assigned assets.
   */
  async fetchAssignedAssets(page, limit, search) {
    const query = {};
    if (search) {
      query.assetId = { $regex: new RegExp(search, 'i') }; // Case-insensitive search on assetId
    }

    const populateOptions = [
      {
        path: 'assignee',
        select: 'firstName lastName employeeId email',
      },
    ];

    const paginationResult = await paginate(
      Assets,
      query,
      page,
      limit,
      { assignedDate: -1 }, // Default sort by assigned date descending
      null,
      populateOptions
    );

    logger.info('Assigned assets fetched successfully:', paginationResult);
    return paginationResult;
  }

  /**
   * Updates the status and/or specifications of an assigned asset.
   * @param {string} assetId - The ID of the asset to update.
   * @param {object} updateData - An object containing the fields to update (status, specifications, serialNo).
   * @returns {Promise<AssignedAsset|null>} - The updated assigned asset record, or null if not found.
   */
  async updateAssignedAsset(assetId, updateData) {
    const { status, specifications, serialNumber } = updateData;

    const existingAsset = await Assets.findOne({ _id: assetId });
    if (!existingAsset) {
      logger.error(`Asset not found for update: ${assetId}`);
      throw new Error('Asset not found');
    }

    const updateFields = {};
    if (status === 'cancelled') {
      if (existingAsset.status !== 'assigned') {
        logger.error(
          `Asset can only be cancelled when in 'assigned' status. Current status: ${existingAsset.status}`
        );
        throw new Error(
          'Asset can only be cancelled when it is in "assigned" status'
        );
      }
    }
    if (status !== undefined) {
      updateFields.status = status;
    }
    if (specifications !== undefined) {
      updateFields.specifications = specifications;
    }
    if (serialNumber !== undefined) {
      updateFields.serialNumber = serialNumber;
    }

    const updatedAsset = await Assets.findOneAndUpdate(
      { _id: assetId },
      { $set: updateFields },
      { new: true }
    ).populate('assignee', 'firstName lastName employeeId email');

    if (!updatedAsset) {
      logger.error(`Failed to update asset: ${assetId}`);
      throw new Error('Failed to update asset');
    }

    logger.info(`Asset ${assetId} updated successfully:`, updatedAsset);
    return updatedAsset;
  }

  /**
   * Fetches a single assigned asset by its ID.
   * @param {string} assetId - The ID of the asset to fetch.
   * @returns {Promise<AssignedAsset|null>} - The assigned asset record, or null if not found.
   */
  async fetchAssignedAssetByUserId(userId) {
    const assignedAsset = await Assets.find({ assignee: userId })
      .populate('assignee', 'firstName lastName employeeId email')
      .populate('assignedBy', 'firstName lastName employeeId email');
    if (!assignedAsset) {
      logger.error(`Assigned asset not found for ID: ${userId}`);
      throw new Error('Assigned asset not found');
    }
    logger.info(`Assigned asset fetched successfully for ID: ${userId}`);
    return assignedAsset;
  }

  async acknowledgeAsset(assetId, userId) {
    const acknowledgedDate = new Date();
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: { status: 'acknowledged', acknowledgedDate: acknowledgedDate } },
      { new: true }
    );
    if (!updatedAssignment) {
      logger.error(`Failed to acknowledge asset: ${assetId}`);
      throw new Error('Failed to acknowledge asset');
    }
    logger.info(
      `Asset ${assetId} acknowledged successfully:`,
      updatedAssignment
    );
    return updatedAssignment;
  }

  async rejectAsset(assetId, userId) {
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: { status: 'not_acknowledged' } },
      { new: true }
    );
    if (!updatedAssignment) {
      logger.error(`Failed to reject asset: ${assetId}`);
      throw new Error('Failed to reject asset');
    }
    logger.info(`Asset ${assetId} not acknowledged successfully:`, updatedAssignment);
    return updatedAssignment;
  }
}

module.exports = new AssetsService();
