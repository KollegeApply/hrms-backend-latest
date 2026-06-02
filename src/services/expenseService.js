const { default: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../utility/ApiError');
const Expense = require('../models/expenseModel');
const User = require('../models/userModel');
const {
  TEAM_LUNCH_PER_ATTENDEE,
  MOBILE_BILL_FIXED_AMOUNT,
  ATTACHMENT_THRESHOLD_AMOUNT,
  FOOD_DAILY_CAP,
  HOTEL_PER_NIGHT_CAP,
  travelPerKmRate,
  TECHNICAL_TOOLS_DEFAULTS,
  TL_ROLES_FOR_TEAM_LUNCH,
} = require('../utility/expensePolicyConstants');

class ExpenseService {
  constructor() {
    this.adminRoles = ['admin', 'subadmin', 'hr'];
    this.superAdminRoles = ['admin', 'subadmin'];
    this.tlRoles = ['teamlead', 'subteamlead'];
    this.finalApproverAdminRoles = ['admin'];
  }

  splitCsvFilter(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  buildRegex(value) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }

  toObjectId(value) {
    if (mongoose.Types.ObjectId.isValid(value)) {
      return new mongoose.Types.ObjectId(value);
    }
    return value;
  }

  async isFinalApproverDepartmentUser(userId) {
    const userWithDepartment = await User.findById(userId)
      .populate('department', 'name')
      .select('department')
      .lean();

    const deptName = userWithDepartment?.department?.name
      ?.toLowerCase()
      ?.trim();

    return deptName === 'expense' || deptName === 'finance';
  }

  hasAttachmentUrl(payload) {
    return Boolean(payload.attachmentUrl && String(payload.attachmentUrl).trim());
  }

  requiresAttachment(payload) {
    const amt = Number(payload.amount);
    if (amt >= ATTACHMENT_THRESHOLD_AMOUNT) return true;
    if (['Mobile Bill', 'Technical Tools', 'Team Lunch'].includes(payload.type)) {
      return true;
    }
    if (payload.type === 'Miscellaneous') {
      const sc = payload.subCategory;
      if (sc === 'Client Gifting' || sc === 'Client Lunch') return true;
    }
    return false;
  }

  resolveExpenseBand(expenseBand) {
    const b = (expenseBand || 'K4').toUpperCase();
    if (['K1', 'K2', 'K3', 'K4'].includes(b)) return b;
    return 'K4';
  }

  roundMoney(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  /** Pending statuses (maps to tl-pending / hr-pending on leave & regularisation lists). */
  expensePendingStatuses() {
    return ['submitted', 'tl-approved'];
  }

  /**
   * Same ordering as Leaves & Regularisation:
   * my pending → tl-pending (HR team first) → hr-pending → other tl-pending → rest (newest).
   */
  buildExpenseSortPriorityBranches(requesterObjectId, requesterRole, hrPriorityTeamUserIds) {
    const pending = this.expensePendingStatuses();
    return {
      $switch: {
        branches: [
          ...(requesterObjectId
            ? [
              {
                case: {
                  $and: [
                    { $eq: ['$userId', requesterObjectId] },
                    { $in: ['$status', pending] },
                  ],
                },
                then: 0,
              },
            ]
            : []),
          ...(requesterRole === 'hr'
            ? [
              {
                case: {
                  $and: [
                    { $eq: ['$status', 'submitted'] },
                    { $in: ['$userId', hrPriorityTeamUserIds] },
                  ],
                },
                then: 1,
              },
              { case: { $eq: ['$status', 'tl-approved'] }, then: 2 },
              { case: { $eq: ['$status', 'submitted'] }, then: 3 },
            ]
            : [
              { case: { $eq: ['$status', 'submitted'] }, then: 1 },
              { case: { $eq: ['$status', 'tl-approved'] }, then: 2 },
            ]),
        ],
        default: requesterRole === 'hr' ? 4 : 3,
      },
    };
  }

  async assertPhase2Policy(user, payload, expenseDate) {
    const submitter = await User.findById(user.id)
      .select('team teamLeadId subTeamLeadId role expenseBand')
      .lean();
    if (!submitter) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const band = this.resolveExpenseBand(submitter.expenseBand);
    const teamName = submitter.team || user.team;

    if (payload.type === 'Team Lunch') {
      if (!TL_ROLES_FOR_TEAM_LUNCH.includes((submitter.role || '').toLowerCase())) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Team Lead or Sub Team Lead can submit Team Lunch expenses.'
        );
      }
      const ids = [...new Set((payload.attendeeUserIds || []).map(String))];
      const attendees = await User.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      })
        .select('_id team')
        .lean();
      if (attendees.length !== ids.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'One or more attendee users are invalid.');
      }
      const wrongTeam = attendees.find((a) => (a.team || '').trim() !== (teamName || '').trim());
      if (wrongTeam) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'All Team Lunch attendees must belong to the same team as the submitter.'
        );
      }
      const expected = this.roundMoney(ids.length * TEAM_LUNCH_PER_ATTENDEE);
      if (this.roundMoney(payload.amount) !== expected) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Team Lunch amount must be Rs.${expected} (${ids.length} attendee(s) × Rs.${TEAM_LUNCH_PER_ATTENDEE}).`
        );
      }
    }

    if (payload.type === 'Mobile Bill') {
      const y = expenseDate.getFullYear();
      const m = expenseDate.getMonth();
      const monthStart = new Date(y, m, 1);
      const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
      const existingBill = await Expense.findOne({
        userId: this.toObjectId(user.id),
        type: 'Mobile Bill',
        isDeleted: { $ne: true },
        date: { $gte: monthStart, $lte: monthEnd },
      }).lean();
      if (existingBill) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Mobile Bill already claimed for this month.'
        );
      }
      if (this.roundMoney(payload.amount) !== MOBILE_BILL_FIXED_AMOUNT) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Mobile Bill amount must be exactly Rs.${MOBILE_BILL_FIXED_AMOUNT}.`
        );
      }
    }

    if (payload.type === 'Travel') {
      const sc = payload.subCategory;
      if (sc === '2 Wheeler' || sc === '4 Wheeler') {
        const rate = travelPerKmRate(sc, band);
        const expected = this.roundMoney(Number(payload.distanceKm) * rate);
        if (this.roundMoney(payload.amount) !== expected) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Travel amount must equal distance × Rs.${rate}/km (expected Rs.${expected}).`
          );
        }
      }
    }

    if (payload.type === 'Food') {
      const tier = payload.subCategory === 'Metro' ? 'metro' : 'nonMetro';
      const daily = FOOD_DAILY_CAP[band]?.[tier];
      if (daily == null) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid Food sub-category for policy.');
      }
      const sameDay = await Expense.find({
        userId: this.toObjectId(user.id),
        type: 'Food',
        subCategory: payload.subCategory,
        date: expenseDate,
        isDeleted: { $ne: true },
      })
        .select('amount')
        .lean();
      const existingSum = sameDay.reduce((s, e) => s + Number(e.amount || 0), 0);
      const total = existingSum + Number(payload.amount);
      if (total > daily * 2) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Food total for this date exceeds twice your daily ${payload.subCategory} cap (Rs.${daily}).`
        );
      }
    }

    if (payload.type === 'Miscellaneous' && payload.subCategory === 'Hotel Accommodation') {
      const tierKey = payload.cityTier === 'Metro' ? 'metro' : 'nonMetro';
      const cap = HOTEL_PER_NIGHT_CAP[band]?.[tierKey];
      if (cap == null) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid hotel city tier.');
      }
      if (Number(payload.amount) > cap * 2) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Hotel claim exceeds twice the per-night cap (Rs.${cap}) for your band and city tier.`
        );
      }
    }

    if (payload.type === 'Technical Tools') {
      const start = new Date(expenseDate.getFullYear(), expenseDate.getMonth(), 1);
      const end = new Date(
        expenseDate.getFullYear(),
        expenseDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );
      const monthSum = await Expense.aggregate([
        {
          $match: {
            userId: this.toObjectId(user.id),
            type: 'Technical Tools',
            isDeleted: { $ne: true },
            date: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const prev = monthSum[0]?.total || 0;
      const nextTotal = prev + Number(payload.amount);
      if (Number(payload.amount) > TECHNICAL_TOOLS_DEFAULTS.maxPerTransaction) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Technical Tools amount exceeds per-transaction limit (Rs.${TECHNICAL_TOOLS_DEFAULTS.maxPerTransaction}).`
        );
      }
      if (nextTotal > TECHNICAL_TOOLS_DEFAULTS.maxPerCalendarMonth) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Technical Tools monthly total would exceed Rs.${TECHNICAL_TOOLS_DEFAULTS.maxPerCalendarMonth}.`
        );
      }
    }

    if (this.requiresAttachment(payload) && !this.hasAttachmentUrl(payload)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Attachment is required for this expense (policy: amount ≥ Rs.150 and/or this expense type).'
      );
    }
  }

  async createExpense(user, payload) {
    const expenseDate = new Date(payload.date);
    expenseDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (expenseDate > today) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Future dates are not allowed for expense submission.'
      );
    }

    const diffInDays = Math.floor((today - expenseDate) / (1000 * 60 * 60 * 24));
    if (diffInDays > 30) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Expense date is outside the maximum allowed backdated window (30 days).'
      );
    }

    const userWithLeads = await User.findById(user.id).select(
      'teamLeadId subTeamLeadId team role'
    );
    if (!userWithLeads) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const teamKey = userWithLeads.team || user.team;

    if (payload.type === 'Team Lunch') {
      const dupTeam = await Expense.findOne({
        team: teamKey,
        date: expenseDate,
        type: 'Team Lunch',
        isDeleted: { $ne: true },
      }).lean();
      if (dupTeam) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'A Team Lunch claim already exists for this team on this date.'
        );
      }
    } else if (payload.type !== 'Mobile Bill') {
      const duplicateExpense = await Expense.findOne({
        userId: user.id,
        date: expenseDate,
        type: payload.type,
        amount: payload.amount,
        isDeleted: { $ne: true },
      });
      if (duplicateExpense) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Duplicate expense detected for same date, type, and amount.'
        );
      }
    }

    await this.assertPhase2Policy(user, payload, expenseDate);

    const hasTeamLead = Boolean(
      userWithLeads.teamLeadId || userWithLeads.subTeamLeadId
    );

    let status = hasTeamLead ? 'submitted' : 'tl-approved';
    let tlId = hasTeamLead ? undefined : user.id;
    let tlRemark = hasTeamLead
      ? undefined
      : 'Auto-routed to finance because team lead is not mapped.';

    if (payload.type === 'Team Lunch') {
      status = 'tl-approved';
      tlId = undefined;
      tlRemark = 'Team Lunch: routed directly to Finance (policy).';
    }

    const attendeeIds =
      payload.type === 'Team Lunch' && Array.isArray(payload.attendeeUserIds)
        ? [...new Set(payload.attendeeUserIds.map((id) => this.toObjectId(id)))]
        : undefined;

    const expense = await Expense.create({
      userId: user.id,
      team: teamKey,
      date: expenseDate,
      name: payload.name,
      type: payload.type,
      subCategory: payload.subCategory || undefined,
      miscellaneousType: payload.miscellaneousType || undefined,
      distanceKm:
        payload.type === 'Travel' &&
        (payload.subCategory === '2 Wheeler' || payload.subCategory === '4 Wheeler')
          ? Number(payload.distanceKm)
          : undefined,
      clientName: payload.clientName?.trim() || undefined,
      clientPocName: payload.clientPocName?.trim() || undefined,
      clientPocDesignation: payload.clientPocDesignation?.trim() || undefined,
      attendeeUserIds: attendeeIds,
      miscOthersDescription: payload.miscOthersDescription?.trim() || undefined,
      travelMiscDescription: payload.travelMiscDescription?.trim() || undefined,
      cityTier: payload.cityTier || undefined,
      amount: Number(payload.amount),
      purpose: payload.purpose,
      attachmentUrl: payload.attachmentUrl || undefined,
      status,
      tlId,
      tlRemark,
    });

    return Expense.findById(expense._id).populate([
      {
        path: 'userId',
        select:
          'firstName lastName employeeId email role teamLeadId subTeamLeadId expenseBand',
      },
      { path: 'tlId', select: 'firstName lastName employeeId email role' },
      { path: 'attendeeUserIds', select: 'firstName lastName employeeId email' },
    ]);
  }

  async getExpenses(user, filters, page = 1, limit = 10) {
    const query = { isDeleted: { $ne: true } };
    const role = user.role;
    const isAdminRole = this.adminRoles.includes(role);
    const isSuperAdminRole = this.superAdminRoles.includes(role);
    const isTlRole = this.tlRoles.includes(role);
    const isFinalApproverAdminRole = this.finalApproverAdminRoles.includes(role);
    const activeQueue = (filters.queue || '').trim().toLowerCase();

    // Default behaviour (My expenses tab): always show current user's own records only.
    if (!activeQueue) {
      query.userId = this.toObjectId(user.id);
    } else if (activeQueue === 'team') {
      // Team approvals tab:
      // - Super admins can view full team queue.
      // - TL/SubTL/HR should see only their mapped reportees.
      if (!isAdminRole && !isTlRole) {
        query.userId = this.toObjectId(user.id);
      } else {
        let teamUsers = [];
        if (isSuperAdminRole) {
          teamUsers = await User.find(
            {
              team: user.team,
              _id: { $ne: user.id },
              isDeleted: { $ne: true },
            },
            '_id'
          );
        } else {
          teamUsers = await User.find(
            {
              team: user.team,
              $or: [{ teamLeadId: user.id }, { subTeamLeadId: user.id }],
              isDeleted: { $ne: true },
            },
            '_id'
          );
        }

        query.userId = { $in: teamUsers.map((entry) => entry._id) };
      }
    } else if (activeQueue === 'finance') {
      // Final queue: only Finance/Expense department users or Admin can action after TL approval.
      const isFinalApproverDeptUser = await this.isFinalApproverDepartmentUser(
        user.id
      );
      if (!(isFinalApproverAdminRole || isFinalApproverDeptUser)) {
        query.userId = this.toObjectId(user.id);
      } else {
        query.team = user.team;
      }
    } else {
      query.userId = this.toObjectId(user.id);
    }

    const statuses = this.splitCsvFilter(filters.status);
    if (statuses.length) {
      query.status = { $in: statuses };
    }

    const types = this.splitCsvFilter(filters.type);
    if (types.length) {
      query.type = { $in: types };
    }

    if (filters.fromDate || filters.toDate) {
      query.date = {};
      if (filters.fromDate) query.date.$gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const toDate = new Date(filters.toDate);
        toDate.setHours(23, 59, 59, 999);
        query.date.$lte = toDate;
      }
    }

    if (filters.search && filters.search.trim()) {
      const searchRegex = this.buildRegex(filters.search.trim());
      const userMatches = await User.find(
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { email: searchRegex },
            { employeeId: searchRegex },
          ],
          isDeleted: { $ne: true },
        },
        '_id'
      );

      query.$or = [
        { name: searchRegex },
        { purpose: searchRegex },
        { type: searchRegex },
        { miscellaneousType: searchRegex },
        { subCategory: searchRegex },
        { clientName: searchRegex },
        {
          userId: {
            $in: userMatches.map((entry) =>
              mongoose.Types.ObjectId.isValid(entry._id)
                ? new mongoose.Types.ObjectId(entry._id)
                : entry._id
            ),
          },
        },
      ];
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const perPage = Math.max(1, Number(limit) || 10);
    const skip = (currentPage - 1) * perPage;

    const populateOptions = [
      {
        path: 'userId',
        select:
          'firstName lastName email employeeId role department teamLeadId subTeamLeadId',
        populate: [{ path: 'department', select: 'name' }],
      },
      { path: 'tlId', select: 'firstName lastName email employeeId role' },
    ];

    const requesterObjectId = this.toObjectId(user.id);
    let hrPriorityTeamUserIds = [];
    if (role === 'hr') {
      const hrTeamMembers = await User.find({
        team: user.team,
        $or: [{ teamLeadId: user.id }, { subTeamLeadId: user.id }],
        isDeleted: { $ne: true },
      }).select('_id');
      hrPriorityTeamUserIds = hrTeamMembers.map((u) => this.toObjectId(u._id));
    }

    const totalDocs = await Expense.countDocuments(query);

    const pipeline = [
      { $match: query },
      {
        $addFields: {
          __sortPriority: this.buildExpenseSortPriorityBranches(
            requesterObjectId,
            role,
            hrPriorityTeamUserIds
          ),
        },
      },
      { $sort: { __sortPriority: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: perPage },
    ];

    let data = await Expense.aggregate(pipeline);
    data = await Expense.populate(data, populateOptions);

    const totalPages = Math.ceil(totalDocs / perPage);
    return {
      data,
      pagination: {
        totalDocs,
        limit: perPage,
        totalPages,
        currentPage,
        pagingCounter: skip + 1,
        hasPrevPage: currentPage > 1,
        hasNextPage: currentPage < totalPages,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        nextPage: currentPage < totalPages ? currentPage + 1 : null,
      },
    };
  }

  async updateExpenseStatus({ expenseId, action, remark, currentUser }) {
    const expense = await Expense.findById(expenseId);
    if (!expense || expense.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found.');
    }

    const isAdmin = this.adminRoles.includes(currentUser.role);
    const isSuperAdmin = this.superAdminRoles.includes(currentUser.role);
    const isTeamLead = this.tlRoles.includes(currentUser.role);

    if (expense.status === 'submitted') {
      if (!isAdmin && !isTeamLead) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Team Lead/Admin can action submitted expenses.'
        );
      }

      const employee = await User.findById(expense.userId).select(
        'teamLeadId subTeamLeadId'
      );
      const isDirectLead =
        employee &&
        (employee.teamLeadId?.toString() === currentUser.id.toString() ||
          employee.subTeamLeadId?.toString() === currentUser.id.toString());

      // For submitted expenses, approval is TL-mapping based.
      // Super admins can still action any submitted expense.
      if (!isSuperAdmin && !isDirectLead) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'You can only action expenses of your reportees.'
        );
      }

      if (action === 'approved') {
        expense.status = 'tl-approved';
      } else {
        if (!remark) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Remark is required for rejection.'
          );
        }
        expense.status = 'tl-rejected';
      }

      expense.tlId = currentUser.id;
      expense.tlRemark = remark || undefined;
      return expense.save();
    }

    if (expense.status === 'tl-approved') {
      const isFinalApproverAdminRole = this.finalApproverAdminRoles.includes(
        currentUser.role
      );
      const isFinalApproverDeptUser = await this.isFinalApproverDepartmentUser(
        currentUser.id
      );

      if (!(isFinalApproverAdminRole || isFinalApproverDeptUser)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Finance/Expense department or Admin can action TL-approved expenses.'
        );
      }

      if (action === 'approved') {
        expense.status = 'finance-approved';
      } else {
        if (!remark) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Remark is required for rejection.'
          );
        }
        expense.status = 'rejected';
      }

      expense.financeRemark = remark || undefined;
      return expense.save();
    }

    throw new ApiError(
      httpStatus.CONFLICT,
      `Expense in '${expense.status}' state cannot be modified.`
    );
  }

  async bulkUpdateExpenseStatus({ expenseIds, remark, action, currentUser }) {
    const succeeded = [];
    const failed = [];
    const actionVerb = action === 'approved' ? 'approve' : 'reject';

    for (const expenseId of expenseIds) {
      try {
        const existing = await Expense.findById(expenseId).select('status');
        if (!existing) {
          failed.push({
            expenseId,
            message: 'Expense not found.',
          });
          continue;
        }

        const previousStatus = existing.status;
        const updated = await this.updateExpenseStatus({
          expenseId,
          action,
          remark,
          currentUser,
        });

        succeeded.push({ updated, previousStatus });
      } catch (err) {
        failed.push({
          expenseId,
          message: err.message || `Failed to ${actionVerb} expense.`,
        });
      }
    }

    return { succeeded, failed };
  }

  async bulkApproveExpenses({ expenseIds, remark, currentUser }) {
    const { succeeded, failed } = await this.bulkUpdateExpenseStatus({
      expenseIds,
      remark,
      action: 'approved',
      currentUser,
    });
    return { approved: succeeded, failed };
  }

  async bulkRejectExpenses({ expenseIds, remark, currentUser }) {
    const { succeeded, failed } = await this.bulkUpdateExpenseStatus({
      expenseIds,
      remark,
      action: 'rejected',
      currentUser,
    });
    return { rejected: succeeded, failed };
  }

  async deleteExpense({ expenseId, currentUser }) {
    const expense = await Expense.findById(expenseId);
    if (!expense || expense.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found.');
    }

    const isAdmin = this.adminRoles.includes(currentUser.role);
    const isOwner = expense.userId?.toString() === currentUser.id?.toString();
    if (!isAdmin && !isOwner) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'You do not have permission to delete this expense.'
      );
    }

    expense.isDeleted = true;
    await expense.save();
    return expense;
  }
}

module.exports = new ExpenseService();
