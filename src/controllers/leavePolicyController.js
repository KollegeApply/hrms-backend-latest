const leavePolicyService = require('../services/leavePolicyService');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

const leavePolicyController = {
  async getAllLeaveTypes(req, res, next) {
    try {
      const userId = req.user.id;
      const types = await leavePolicyService.getAllLeaveTypes(userId);
      res.json(types);
    } catch (err) {
      next(err);
    }
  },

  async getAllPolicies(req, res, next) {
    try {
      const policies = await leavePolicyService.getAllPolicies();
      res.json(policies);
    } catch (err) {
      next(err);
    }
  },

  async getPolicyMappings(req, res, next) {
    try {
      const { policyId } = req.query;
      if (!policyId) throw new ApiError(httpStatus.BAD_REQUEST, 'policyId is required');
      const mappings = await leavePolicyService.getPolicyMappings(policyId);
      res.json(mappings);
    } catch (err) {
      next(err);
    }
  },

  async createPolicy(req, res, next) {
    try {
      const policy = await leavePolicyService.createPolicy(req.body);
      res.status(201).json(policy);
    } catch (err) {
      next(err);
    }
  },

  async createLeaveType(req, res, next) {
    try {
      const type = await leavePolicyService.createLeaveType(req.body);
      res.status(201).json(type);
    } catch (err) {
      next(err);
    }
  },

  async createPolicyMapping(req, res, next) {
    try {
      const mapping = await leavePolicyService.createPolicyMapping(req.body);
      res.status(201).json(mapping);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = leavePolicyController; 