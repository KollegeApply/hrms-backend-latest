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
      assetType,
      assetName,
      assignee,
      serialNumber,
      specifications,
      status = 'assigned',
      assignedBy,
      laptopType,
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

    const newAssignment = new Assets({
      assetType,
      assetName,
      assignee,
      serialNumber,
      specifications,
      status: status,
      assignedBy,
      laptopType, 
    });
    await newAssignment.save();
    logger.info('Asset assigned successfully:', newAssignment);
    return newAssignment;
  }

  /**
   * Fetches all assigned assets.
   * @returns {Promise<AssignedAsset[]>} - List of assigned assets.
   */
async fetchAssignedAssets(page, limit, search, team) {
    const query = {};

     if (search) {
      query.$text = { $search: search };
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
      }
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
      .sort({ createdAt: -1 })
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
    logger.info(
      `Asset ${assetId} not acknowledged successfully:`,
      updatedAssignment
    );
    return updatedAssignment;
  }

  async returnAsset(assetId, userId) {
    const updatedAssignment = await Assets.findOneAndUpdate(
      { _id: assetId, assignee: userId },
      { $set: { status: 'return_requested' } },
      { new: true }
    );
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
        $project: {
          assetType: 1,
          assetName: 1,
          serialNumber: 1,
          specifications: 1,
          status: 1,
          assignedBy: 1,
          assignedDate: 1,
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
      ).populate('assignee', 'firstName lastName employeeId email');

      if (!request) {
        logger.error(`Asset request not found: ${requestId}`);
        throw new Error('Asset request not found');
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
      const matchStage = {
        assetType: 'laptop',
        laptopType: { $exists: true, $ne: null },
        status: { $nin: ['returned', 'cancelled', 'not_acknowledged'] },
      };

      const summary = await Assets.aggregate([
        {
          $match: matchStage,
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
              laptopType: '$laptopType',
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
      }
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
