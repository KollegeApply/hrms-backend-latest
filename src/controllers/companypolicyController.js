const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const ApiError = require('../utility/ApiError');
const companyPolicyService = require('../services/companypolicyService');
const { USER_ROLES } = require('../utility/constants');

/**
 * Get all company policies (BYOD + NDA) for logged-in user
 */
const getAllCompanyPolicies = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const policies = await companyPolicyService.getAllPoliciesByUser(userId);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Company policies retrieved successfully.',
    data: policies,
  });
});

/**
 * Get single policy by type (BYOD | NDA) for logged-in user
 */
const getCompanyPolicyByType = catchAsync(async (req, res) => {
  const { type } = req.params;
  const userId = req.user._id;

  const policy = await companyPolicyService.getPolicyByTypeAndUser(
    type,
    userId
  );

  if (!policy) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found.');
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Company policy retrieved successfully.',
    data: policy,
  });
});

/**
 * Submit a company policy (BYOD | NDA) for logged-in user
 * -> updates status to SUBMITTED for that user + policy type
 */
const submitCompanyPolicyByType = catchAsync(async (req, res) => {
  const { type } = req.params;
  const userId = req.user._id;

  const policy = await companyPolicyService.submitPolicyForUser(type, userId);

  if (!policy) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found.');
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Company policy submitted successfully.',
    data: policy,
  });
});

/**
 * View company policy statuses for employees (role-based)
 * - TL: only their team members
 * - HR/Admin/Subadmin: all employees
 */
const viewCompanyPolicyStatuses = catchAsync(async (req, res) => {
  const currentUser = req.user;
  const { page, limit, search, byodStatus, ndaStatus, paginate } = req.query;

  const allowedRoles = [
    USER_ROLES.TEAMLEAD,
    USER_ROLES.HR,
    USER_ROLES.ADMIN,
    USER_ROLES.SUBADMIN,
  ];

  if (!allowedRoles.includes(currentUser.role)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'You are not authorized to view policy statuses.'
    );
  }

  const result = await companyPolicyService.getPoliciesForView(
    currentUser,
    {
      page,
      limit,
      search,
      byodStatus,
      ndaStatus,
      // treat "false" (string) as false, anything else (or missing) as true
      paginate: paginate === 'false' ? false : true,
    }
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Company policy statuses retrieved successfully.',
    data: result,
  });
});

module.exports = {
  getAllCompanyPolicies,
  getCompanyPolicyByType,
  submitCompanyPolicyByType,
  viewCompanyPolicyStatuses,
};
