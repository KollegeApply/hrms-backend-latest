const User = require('../models/userModel');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const Assets = require('../models/assetsModel'); // Corrected model name
const AssetInventory = require('../models/assetInventoryModel');
const { paginate } = require('../utility/common');

const INVENTORY_ASSET_POPULATE = {
  path: 'inventoryAsset',
  select:
    'assetId assetType assetName serialNumber laptopType specifications brand model status assignedTo',
};

class AssetsService {
  /**
   * Assigns an asset to an employee and sends an email notification.
   * @param {object} assignmentData - Data for the asset assignment.
   * @returns {Promise<AssignedAsset>} - The newly created assigned asset record.
   */
  async assignAsset(assignmentData) {
    const {
      assetType,
      assetName,
      assignee,
      serialNumber,
      specifications,
      status = 'assigned',
      returnRequestDate,
      assignedBy,
      laptopType,
      inventoryAssetId,
      assignmentType = 'permanent',
      temporaryUntil,
    } = assignmentData;

    // Validate the asset ID
    // const asset = await Assets.findOne({
    //   assetId: assetId,
    //   status: { $nin: ['cancelled', 'not_acknowledged', 'returned'] },
    // });
    // if (asset) {
    //   logger.error('Asset is already assigned', assetId);
    //   throw new Error('Asset is already assigned');
    // }

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


    if(user?.team !== assignedByUser?.team){
      throw new Error("You can't assign this user.")
    }

    let inventoryAsset = null;
    if (inventoryAssetId) {
      inventoryAsset = await AssetInventory.findOne({
        _id: inventoryAssetId,
        isDeleted: false,
      });
      if (!inventoryAsset) {
        throw new Error('Inventory asset not found');
      }
      if (inventoryAsset.status !== 'available') {
        throw new Error('Inventory asset is not available');
      }
    }

    const baseAssignment = {
      assignee,
      returnRequestDate,
      status,
      assignedBy,
      assignmentType,
      temporaryUntil: assignmentType === 'temporary' ? temporaryUntil : undefined,
    };

    if (inventoryAsset) {
      Object.assign(baseAssignment, {
        inventoryAsset: inventoryAsset._id,
      });
    } else {
      Object.assign(baseAssignment, {
        assetType,
        assetName,
        serialNumber,
        specifications,
        laptopType,
      });
    }

    const newAssignment = new Assets(baseAssignment);
    await newAssignment.save();

    if (inventoryAsset) {
      await AssetInventory.updateOne(
        { _id: inventoryAsset._id },
        { $set: { status: 'assigned', assignedTo: assignee } }
      );
    }

    const populated = await Assets.findById(newAssignment._id)
      .populate('assignee', 'firstName lastName employeeId email department')
      .populate('assignedBy', 'firstName lastName employeeId email team')
      .populate(INVENTORY_ASSET_POPULATE);

    logger.info('Asset assigned successfully:', populated);
    return populated;
  }

  /**
   * Fetches all assigned assets.
   * @returns {Promise<AssignedAsset[]>} - List of assigned assets.
   */
async fetchAssignedAssets(page, limit, search, team) {
    const query = {};

    if (search) {
      const searchTerm = search.trim();

      // Search by employee name (firstName, lastName) and employeeId only
      const searchUsers = await User.find({
        $or: [
          { firstName: { $regex: searchTerm, $options: 'i' } },
          { lastName: { $regex: searchTerm, $options: 'i' } },
          { employeeId: { $regex: searchTerm, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = searchUsers.map(user => user._id);

      if (userIds.length > 0) {
        query.$or = [
          { assignee: { $in: userIds } },
          { assignedBy: { $in: userIds } }
        ];
      } else {
        // If no users found, return empty result
        query._id = { $in: [] };
      }
    }

    if (team) {
      const usersInTeam = await User.find({ team: team }).select('_id');
      
      const userIds = usersInTeam.map(user => user._id);
      query.assignedBy = { $in: userIds };
    }

    const populateOptions = [
      {
        path: 'assignee',
        select: 'firstName lastName employeeId email department',
      },
      {
        path: 'assignedBy',
        select: 'firstName lastName employeeId email team'
      },
      INVENTORY_ASSET_POPULATE,
    ];

    const paginationResult = await paginate(
      Assets,
      query,
      page,
      limit,
      { assignedDate: -1 },
      null,
      populateOptions
    );

    logger.info('Assigned assets fetched successfully:', paginationResult);
    return paginationResult;
}

  /**
   * Updates the status and/or specifications of an assigned asset.
   * @param {string} assetType - The Type of the asset to update.
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
      if (existingAsset.status === 'cancelled') {
        logger.error(`Asset is already cancelled: ${assetId}`);
        throw new Error('Asset is already cancelled');
      }
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
    if (!existingAsset.inventoryAsset) {
      if (specifications !== undefined) {
        updateFields.specifications = specifications;
      }
      if (serialNumber !== undefined) {
        updateFields.serialNumber = serialNumber;
      }
    }

    const updatedAsset = await Assets.findOneAndUpdate(
      { _id: assetId },
      { $set: updateFields },
      { new: true }
    )
      .populate('assignee', 'firstName lastName employeeId email')
      .populate(INVENTORY_ASSET_POPULATE);

    if (!updatedAsset) {
      logger.error(`Failed to update asset: ${assetId}`);
      throw new Error('Failed to update asset');
    }

    if (status !== undefined && existingAsset.inventoryAsset) {
      if (status === 'returned' || status === 'cancelled' || status === 'not_acknowledged') {
        await AssetInventory.updateOne(
          { _id: existingAsset.inventoryAsset },
          { $set: { status: 'available', assignedTo: null } }
        );
      }
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
      .populate('assignedBy', 'firstName lastName employeeId email')
      .populate(INVENTORY_ASSET_POPULATE);
    if (!assignedAsset) {
      logger.error(`Assigned asset not found for ID: ${userId}`);
      throw new Error('Assigned asset not found');
    }

    // Custom status order required by UI
    const statusOrder = [
      'acknowledged',
      'assigned',
      'not_acknowledged',
      'return_requested',
      'return_approved',
      'returned',
      'return_rejected',
      'cancelled',
    ];
    const orderMap = statusOrder.reduce((acc, status, idx) => {
      acc[status] = idx;
      return acc;
    }, {});

    assignedAsset.sort((a, b) => {
      const aRank = orderMap[a.status] ?? Number.MAX_SAFE_INTEGER;
      const bRank = orderMap[b.status] ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;

      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime; // newest first within same status
    });

    logger.info(`Assigned asset fetched successfully for ID: ${userId}`);
    return assignedAsset;
  }

  async acknowledgeAsset(assetId, userId) {
    const acknowledgedDate = new Date();
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: { status: 'acknowledged', acknowledgedDate: acknowledgedDate } },
      { new: true }
    )
      .populate(INVENTORY_ASSET_POPULATE);
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

  async rejectAsset(assetId, userId, rejectionReason = '') {
    const updateData = { 
      status: 'not_acknowledged',
      ...(rejectionReason && { rejectionReason })
    };
    
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: updateData },
      { new: true }
    )
      .populate(INVENTORY_ASSET_POPULATE);
    if (!updatedAssignment) {
      logger.error(`Failed to reject asset: ${assetId}`);
      throw new Error('Failed to reject asset');
    }
    logger.info(
      `Asset ${assetId} not acknowledged successfully with reason: ${rejectionReason || 'No reason provided'}`,
      updatedAssignment
    );

    // When an assignee rejects (not_acknowledged), the inventory item should become available again.
    if (updatedAssignment?.inventoryAsset) {
      await AssetInventory.updateOne(
        { _id: updatedAssignment.inventoryAsset },
        { $set: { status: 'available', assignedTo: null } }
      );
    }

    return updatedAssignment;
  }

  async returnAsset(assetId, userId) {
    const returnRequestDate = new Date();
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: { status: 'return_requested', returnRequestDate: returnRequestDate } },
      { new: true }
    )
      .populate(INVENTORY_ASSET_POPULATE);
    if (!updatedAssignment) {
      logger.error(`Failed to return request asset: ${assetId}`);
      throw new Error('Failed to return request asset');
    }
    logger.info(
      `Asset ${assetId} return request successfully:`,
      updatedAssignment
    );
    return updatedAssignment;
  }

 async fetchAssetRequests(team) {
  try {
    const requests = await Assets.aggregate([
      {
        $match: {
          status: {
            $in: ['return_requested', 'return_approved', 'return_rejected'],
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignee',
          foreignField: '_id',
          as: 'assignee',
        },
      },
      {
        $unwind: '$assignee',
      },
      {
        $match: {
          'assignee.team': team,
        },
      },
      {
        $lookup: {
          from: 'assetinventories',
          localField: 'inventoryAsset',
          foreignField: '_id',
          as: '_invRows',
        },
      },
      {
        $addFields: {
          _inv: { $arrayElemAt: ['$_invRows', 0] },
        },
      },
      {
        $project: {
          assetType: { $ifNull: ['$assetType', '$_inv.assetType'] },
          assetName: { $ifNull: ['$assetName', '$_inv.assetName'] },
          serialNumber: { $ifNull: ['$serialNumber', '$_inv.serialNumber'] },
          specifications: { $ifNull: ['$specifications', '$_inv.specifications'] },
          inventoryAsset: 1,
          status: 1,
          assignedBy: 1,
          assignedDate: 1,
          returnRequestDate: 1,
          createdAt: 1,
          updatedAt: 1,
          assignee: {
            _id: '$assignee._id',
            firstName: '$assignee.firstName',
            lastName: '$assignee.lastName',
            email: '$assignee.email',
            employeeId: '$assignee.employeeId',
            team: '$assignee.team',
          },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
    ]);

    logger.info(`Asset requests for team ${team} fetched successfully`);
    return requests;
  } catch (error) {
    logger.error('Error fetching team-based asset requests:', error);
    throw error;
  }
}


  async updateAssetRequestStatus(requestId, newStatus) {
    try {
      const request = await Assets.findByIdAndUpdate(
        requestId,
        { status: newStatus },
        { new: true }
      )
        .populate({
          path: 'assignee',
          select: 'firstName lastName employeeId email jobTitle department teamLeadId subTeamLeadId',
          populate: [
            { path: 'department', select: 'name' },
            { path: 'teamLeadId', select: 'firstName lastName' },
            { path: 'subTeamLeadId', select: 'firstName lastName' },
          ],
        })
        .populate(INVENTORY_ASSET_POPULATE);

      if (!request) {
        logger.error(`Asset request not found: ${requestId}`);
        throw new Error('Asset request not found');
      }

      if ((newStatus === 'returned' || newStatus === 'cancelled' || newStatus === 'not_acknowledged') && request.inventoryAsset) {
        await AssetInventory.updateOne(
          { _id: request.inventoryAsset },
          { $set: { status: 'available', assignedTo: null } }
        );
      }

      logger.info(
        `Asset request ${requestId} updated to ${newStatus}:`,
        request
      );
      return request;
    } catch (error) {
      logger.error(
        `Error updating asset request ${requestId} to ${newStatus}:`,
        error
      );
      throw error;
    }
  }

async getPCDepartmentSummary(team) {
    try {
      const statusMatch = {
        status: { $nin: ['returned', 'cancelled', 'not_acknowledged'] },
      };

      const summary = await Assets.aggregate([
        { $match: statusMatch },
        {
          $lookup: {
            from: 'assetinventories',
            localField: 'inventoryAsset',
            foreignField: '_id',
            as: '_invRows',
          },
        },
        {
          $addFields: {
            _inv: { $arrayElemAt: ['$_invRows', 0] },
            effectiveAssetType: { $ifNull: ['$assetType', '$_inv.assetType'] },
            effectiveLaptopType: { $ifNull: ['$laptopType', '$_inv.laptopType'] },
          },
        },
        {
          $match: {
            effectiveAssetType: 'laptop',
            effectiveLaptopType: { $exists: true, $nin: [null, ''] },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'assignee',
            foreignField: '_id',
            as: 'assigneeDetails',
          },
        },
        {
          $unwind: '$assigneeDetails',
        },
        ...(team ? [{
          $match: {
            'assigneeDetails.team': team
          }
        }] : []),
        {
          $lookup: {
            from: 'departments',
            localField: 'assigneeDetails.department',
            foreignField: '_id',
            as: 'departmentDetails',
          },
        },
        {
          $unwind: '$departmentDetails',
        },
        {
          $group: {
            _id: {
              laptopType: '$effectiveLaptopType',
              departmentName: '$departmentDetails.name',
            },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.laptopType',
            totalDevices: { $sum: '$count' },
            departments: {
              $push: {
                departmentName: '$_id.departmentName',
                count: '$count',
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            pcType: '$_id',
            totalDevices: 1,
            departments: 1,
          },
        },
        {
          $sort: { pcType: 1 },
        },
      ]);

      return summary;
    } catch (error) {
      logger.error('Error fetching PC department summary:', error);
      throw error;
    }
  }

  /**
   * Fetches assigned assets for team members under a specific team lead
   * @param {string} teamLeadId - Team lead user ID
   * @param {number} page - Page number
   * @param {number} limit - Number of items per page
   * @param {string} search - Search term
   * @returns {Promise<object>} - Paginated assigned assets for team members
   */
  async fetchTeamAssetsByTeamLead(teamLeadId, page, limit, search) {
    const query = {};

    if (search) {
      query.$text = { $search: search };
    }

    // First, get all users who have this teamLeadId
    const teamMembers = await User.find({ teamLeadId: teamLeadId }).select('_id');
    const teamMemberIds = teamMembers.map(member => member._id);

    if (teamMemberIds.length === 0) {
      // Return empty result if no team members found
      return {
        data: [],
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: limit,
        },
      };
    }

    // Find assets assigned to team members
    query.assignee = { $in: teamMemberIds };

    const populateOptions = [
      {
        path: 'assignee',
        select: 'firstName lastName employeeId email department teamLeadId',
      },
      {
        path: 'assignedBy',
        select: 'firstName lastName employeeId email team'
      },
      INVENTORY_ASSET_POPULATE,
    ];

    const paginationResult = await paginate(
      Assets,
      query,
      page,
      limit,
      { assignedDate: -1 },
      null,
      populateOptions
    );

    logger.info(`Team assets fetched successfully for team lead ${teamLeadId}:`, paginationResult);
    return paginationResult;
  }
}

module.exports = new AssetsService();
