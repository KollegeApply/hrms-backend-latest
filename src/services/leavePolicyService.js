const LeavePolicy = require('../models/leavePolicyModel');
const LeaveType = require('../models/leaveTypeModel');
const LeavePolicyMapping = require('../models/leavePolicyMappingModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');
const User = require('../models/userModel');

class LeavePolicyService {
  // Get all leave types
  async getAllLeaveTypes(userId) {
    try {
      const user = await User.findById(userId);
  
      if (!user || !user.leavePolicyId) {
        throw new Error('User or leave policy not found');
      }
  
      // Step 1: Get mappings for this user's leave policy
      const mappings = await LeavePolicyMapping.find({
        leavePolicyId: user.leavePolicyId,
      });
  
      const leaveTypeIds = mappings.map((m) => m.leaveTypeId);
  
      // Step 2: Return only leave types that are mapped
      const leaveTypes = await LeaveType.find({
        _id: { $in: leaveTypeIds },
        isDeleted: false,
      });
  
      return leaveTypes;
    } catch (error) {
      console.error('Error in getAllLeaveTypes:', error);
      return [];
    }
  }

  // Get all leave policies
  async getAllPolicies() {
    return LeavePolicy.find({ isDeleted: false });
  }

  // Get all mappings for a policy
  async getPolicyMappings(policyId) {
    return LeavePolicyMapping.find({
      leavePolicyId: policyId,
      isDeleted: false,
    }).populate('leaveTypeId');
  }

  // Create a new policy
  async createPolicy(data) {
    const policy = new LeavePolicy(data);
    return policy.save();
  }

  // Create a new leave type
  async createLeaveType(data) {
    const leaveType = new LeaveType(data);
    return leaveType.save();
  }

  // Create a new policy mapping
  async createPolicyMapping(data) {
    const mapping = new LeavePolicyMapping(data);
    return mapping.save();
  }

  // Update policy, leave type, or mapping (add as needed)
}

module.exports = new LeavePolicyService();
