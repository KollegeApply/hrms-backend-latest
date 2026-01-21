const CompanyPolicy = require('../models/companypolicyModel');
const User = require('../models/userModel');

/**
 * Get all policies (BYOD + NDA) for a user
 */
const getAllPoliciesByUser = async (userId) => {
  return await CompanyPolicy.find({
    userId,
    isDeleted: false,
    policyType: { $in: ['BYOD', 'NDA'] },
  }).sort({ createdAt: -1 });
};

/**
 * Get single policy by type for a user
 */
const getPolicyByTypeAndUser = async (type, userId) => {
  return await CompanyPolicy.findOne({
    userId,
    policyType: type.toUpperCase(),
    isDeleted: false,
  });
};

/**
 * Mark a policy (BYOD | NDA) as SUBMITTED for a user
 */
const submitPolicyForUser = async (type, userId) => {
  return await CompanyPolicy.findOneAndUpdate(
    {
      userId,
      policyType: type.toUpperCase(),
      isDeleted: false,
    },
    {
      status: 'SUBMITTED',
      effectiveDate: new Date(),
    },
    {
      new: true,
    }
  );
};

/**
 * Get policy statuses for view (role-based visibility) with pagination + filters
 * - TL: only their team members (teamLeadId / subTeamLeadId = current user, same team)
 * - HR/Admin/Subadmin: only active employees from their team (SD / KAPP etc.)
 * - Supports: search (name/email/employeeId), BYOD status filter, NDA status filter
 */
const getPoliciesForView = async (
  currentUser,
  { page = 1, limit = 10, search, byodStatus, ndaStatus, paginate = true } = {}
) => {
  const { _id: currentUserId, role, team } = currentUser;

  // Base user filter: active, not deleted
  const baseUserFilter = {
    status: { $in: ['probation', 'onroll'] },
    isDeleted: false,
  };

  let userFilter = { ...baseUserFilter };

  if (role === 'teamlead') {
    // TL → only their direct + sub-team members (within their team)
    userFilter.team = team;
    userFilter.$or = [
      { teamLeadId: currentUserId },
      { subTeamLeadId: currentUserId },
    ];
  } else if (['admin', 'subadmin', 'hr'].includes(role)) {
    // HR/Admin/Subadmin → only users from their team (SD / KAP etc.)
    userFilter.team = team;
  } else {
    // Other roles are not allowed to use this view
    return {
      data: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
        itemsPerPage: Number(limit) || 10,
      },
    };
  }

  // Optional search filter on user fields
  let finalUserQuery = { ...userFilter };
  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    // Support multi-word search like "rishabh test"
    const tokens = trimmedSearch.split(/\s+/).filter(Boolean);

    const tokenConditions = tokens.map((token) => {
      const tokenRegex = new RegExp(token, 'i');
      return {
        $or: [
          { firstName: tokenRegex },
          { lastName: tokenRegex },
          { email: tokenRegex },
          { employeeId: { $regex: token, $options: 'i' } },
        ],
      };
    });

    if (finalUserQuery.$and) {
      finalUserQuery.$and.push(...tokenConditions);
    } else {
      finalUserQuery = {
        $and: [finalUserQuery, ...tokenConditions],
      };
    }
  }

  // Fetch all matching users for this team/role/search
  const users = await User.find(finalUserQuery)
    .select('_id firstName lastName email employeeId department team jobTitle')
    .populate('department', 'name')
    .sort({ firstName: 1, lastName: 1 });

  const userIds = users.map((u) => u._id);

  if (userIds.length === 0) {
    return {
      data: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
        itemsPerPage: Number(limit) || 10,
      },
    };
  }

  const policies = await CompanyPolicy.find({
    userId: { $in: userIds },
    isDeleted: false,
  }).sort({ createdAt: -1 });

  // Map policies per user for BYOD / NDA
  const policiesByUser = new Map();

  policies.forEach((policy) => {
    const uid = policy.userId.toString();
    if (!policiesByUser.has(uid)) {
      policiesByUser.set(uid, {});
    }
    const entry = policiesByUser.get(uid);
    if (policy.policyType === 'BYOD') {
      entry.byodStatus = policy.status;
      entry.byodEffectiveDate = policy.effectiveDate || null;
    } else if (policy.policyType === 'NDA') {
      entry.ndaStatus = policy.status;
      entry.ndaEffectiveDate = policy.effectiveDate || null;
    }
  });

  const normalizedByodStatus = byodStatus?.toUpperCase();
  const normalizedNdaStatus = ndaStatus?.toUpperCase();

  // Build final view rows (one row per user) and apply status filters
  const allRows = users.map((user) => {
    const userPolicies = policiesByUser.get(user._id.toString()) || {};
    const byod = userPolicies.byodStatus || 'PENDING';
    const nda = userPolicies.ndaStatus || 'PENDING';

    // Overall Yes/No: Yes only if both BYOD & NDA are SUBMITTED
    const overallStatusYes = byod === 'SUBMITTED' && nda === 'SUBMITTED';

    return {
      kappId: user.employeeId || '',
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      team: user.team || '',
      department: user.department
        ? { id: user.department._id || user.department, name: user.department.name || '' }
        : null,
      email: user.email || '',
      designation: user.jobTitle || '',
      policyName1: 'BYOD',
      policy1Status: byod,
      policy1EffectiveDate: userPolicies.byodEffectiveDate || null,
      policyName2: 'NDA',
      policy2Status: nda,
      policy2EffectiveDate: userPolicies.ndaEffectiveDate || null,
      statusYesNo: overallStatusYes ? 'Yes' : 'No',
      userId: user._id,
    };
  });

  const filteredRows = allRows.filter((row) => {
    if (normalizedByodStatus && row.policy1Status !== normalizedByodStatus) {
      return false;
    }
    if (normalizedNdaStatus && row.policy2Status !== normalizedNdaStatus) {
      return false;
    }
    return true;
  });

  const totalItems = filteredRows.length;

  // If pagination is disabled (e.g. CSV download) return full filtered list
  if (!paginate) {
    return {
      data: filteredRows,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems,
        itemsPerPage: totalItems,
      },
    };
  }

  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 && Number(limit) <= 100
      ? Number(limit)
      : 10;

  const totalPages = Math.ceil(totalItems / safeLimit) || 0;
  const startIndex = (safePage - 1) * safeLimit;
  const paginatedRows = filteredRows.slice(startIndex, startIndex + safeLimit);

  return {
    data: paginatedRows,
    pagination: {
      currentPage: safePage,
      totalPages,
      totalItems,
      itemsPerPage: safeLimit,
    },
  };
};

module.exports = {
  getAllPoliciesByUser,
  getPolicyByTypeAndUser,
  submitPolicyForUser,
  getPoliciesForView,
};
