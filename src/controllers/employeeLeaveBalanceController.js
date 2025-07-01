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
};

module.exports = employeeLeaveBalanceController;
