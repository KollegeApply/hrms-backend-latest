const employeeLeaveBalanceService = require('../services/employeeLeaveBalanceService');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

const employeeLeaveBalanceController = {
  async getBalancesForEmployee(req, res, next) {
    try {
      const { employeeId } = req.query;
      if (!employeeId)
        throw new ApiError(httpStatus.BAD_REQUEST, 'employeeId is required');
      const balances = await employeeLeaveBalanceService.getBalancesForEmployee(employeeId);
      res.json(balances);
    } catch (err) {
      next(err);
    }
  },

  async getBalancesForEmployees(req, res, next) {
    try {
      const { employeeIds } = req.body;
      if (!Array.isArray(employeeIds) || employeeIds.length === 0)
        throw new ApiError(httpStatus.BAD_REQUEST, 'employeeIds must be a non-empty array');
      if (employeeIds.length > 1000)
        throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 1000 employeeIds allowed');
      const balances = await employeeLeaveBalanceService.getBalancesForEmployees(employeeIds);
      res.json(balances);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = employeeLeaveBalanceController;
