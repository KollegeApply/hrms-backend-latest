const User = require('../models/userModel');
const AssetRequest = require('../models/assetRequestModel');
const logger = require('../config/logger');
const { paginate } = require('../utility/common');

class AssetRequestService {
  /**
   * Creates a new asset request
   * @param {object} requestData - Data for the asset request
   * @returns {Promise<AssetRequest>} - The newly created asset request
   */
  async createAssetRequest(requestData) {
    const {
      assetType,
      specifications,
      neededBy,
      requestedBy,
      description,
    } = requestData;

    // Validate the requestedBy user
    const user = await User.findById(requestedBy);
    if (!user) {
      logger.error('User not found', requestedBy);
      throw new Error('User not found');
    }

    const newRequest = new AssetRequest({
      assetType,
      specifications,
      neededBy,
      requestedBy,
      description,
      status: 'asset-request-pending',
    });

    await newRequest.save();
    logger.info('Asset request created successfully:', newRequest);
    return newRequest;
  }

  /**
   * Fetches all asset requests with pagination and search
   * @param {number} page - Page number
   * @param {number} limit - Number of items per page
   * @param {string} search - Search term
   * @param {string} team - Team filter
   * @returns {Promise<object>} - Paginated asset requests
   */
  async fetchAssetRequests(page, limit, search, team) {
    const query = {};

    if (search) {
      query.$text = { $search: search };
    }

    if (team) {
      const usersInTeam = await User.find({ team: team }).select('_id');
      const userIds = usersInTeam.map(user => user._id);
      query.requestedBy = { $in: userIds };
    }

    const populateOptions = [
      {
        path: 'requestedBy',
        select: 'firstName lastName employeeId email department team',
      },
      {
        path: 'approvedBy',
        select: 'firstName lastName employeeId email team',
      },
    ];

    const paginationResult = await paginate(
      AssetRequest,
      query,
      page,
      limit,
      { createdAt: -1 },
      null,
      populateOptions
    );

    logger.info('Asset requests fetched successfully:', paginationResult);
    return paginationResult;
  }

  /**
   * Fetches asset requests by user ID
   * @param {string} userId - User ID
   * @returns {Promise<AssetRequest[]>} - List of asset requests for the user
   */
  async fetchAssetRequestsByUserId(userId) {
    const assetRequests = await AssetRequest.find({ requestedBy: userId })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'firstName lastName employeeId email')
      .populate('approvedBy', 'firstName lastName employeeId email');

    if (!assetRequests) {
      logger.error(`Asset requests not found for user ID: ${userId}`);
      throw new Error('Asset requests not found');
    }

    logger.info(`Asset requests fetched successfully for user ID: ${userId}`);
    return assetRequests;
  }

  /**
   * Updates asset request status
   * @param {string} requestId - Asset request ID
   * @param {string} status - New status
   * @param {string} approvedBy - User ID who approved/rejected
   * @param {string} rejectionReason - Reason for rejection (if applicable)
   * @returns {Promise<AssetRequest>} - Updated asset request
   */
  async updateAssetRequestStatus(requestId, status, approvedBy, rejectionReason = null) {
    const updateFields = {
      status,
      approvedBy,
      approvedDate: new Date(),
    };

    if (rejectionReason) {
      updateFields.rejectionReason = rejectionReason;
    }

    const updatedRequest = await AssetRequest.findByIdAndUpdate(
      requestId,
      { $set: updateFields },
      { new: true }
    ).populate('requestedBy', 'firstName lastName employeeId email')
     .populate('approvedBy', 'firstName lastName employeeId email');

    if (!updatedRequest) {
      logger.error(`Asset request not found: ${requestId}`);
      throw new Error('Asset request not found');
    }

    logger.info(`Asset request ${requestId} updated to ${status}:`, updatedRequest);
    return updatedRequest;
  }

  /**
   * Marks asset request as fulfilled
   * @param {string} requestId - Asset request ID
   * @param {string} assignedAssetId - Assigned asset ID
   * @returns {Promise<AssetRequest>} - Updated asset request
   */
  async fulfillAssetRequest(requestId, assignedAssetId) {
    const updatedRequest = await AssetRequest.findByIdAndUpdate(
      requestId,
      { 
        $set: { 
          status: 'fulfilled',
          fulfilledDate: new Date(),
          assignedAsset: assignedAssetId
        } 
      },
      { new: true }
    ).populate('requestedBy', 'firstName lastName employeeId email')
     .populate('approvedBy', 'firstName lastName employeeId email');

    if (!updatedRequest) {
      logger.error(`Asset request not found: ${requestId}`);
      throw new Error('Asset request not found');
    }

    logger.info(`Asset request ${requestId} marked as fulfilled:`, updatedRequest);
    return updatedRequest;
  }
}

module.exports = new AssetRequestService();
