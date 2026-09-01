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
  TL_ROLES_FOR_TEAM_LUNCH,
} = require('../utility/expensePolicyConstants');

/** Special support account allowed to view All Expenses and TL-approve/reject submitted rows. */
const ALL_EXPENSES_SUPPORT_EMAIL = 'support@kollegeapply.com';

class ExpenseService {
  constructor() {
    this.adminRoles = ['admin', 'subadmin', 'hr'];
    this.superAdminRoles = ['admin', 'subadmin'];
    this.tlRoles = ['teamlead', 'subteamlead'];
    this.finalApproverAdminRoles = ['admin'];
    // Full team expense dashboard: admin, subadmin, hr, or Finance/Expense department.
    this.expenseDashboardTeamViewRoles = ['admin', 'subadmin', 'hr'];
  }

  /** Authenticated user email must match the dedicated All Expenses support account. */
  isAllExpensesSupportUser(user) {
    const email = String(user?.email || '')
      .trim()
      .toLowerCase();
    return email === ALL_EXPENSES_SUPPORT_EMAIL;
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

  async getUserDepartmentName(userId) {
    const userWithDepartment = await User.findById(userId)
      .populate('department', 'name')
      .select('department')
      .lean();

    return userWithDepartment?.department?.name?.toLowerCase()?.trim();
  }

  /**
   * Combined check kept only for reporting/dashboard visibility
   * (`resolveExpenseDashboardAccess`), which intentionally treats the
   * Expense and Finance departments as equivalent for viewing team-wide
   * numbers. Approval-action gating uses the split checks below instead.
   */
  async isFinalApproverDepartmentUser(userId) {
    const deptName = await this.getUserDepartmentName(userId);
    return deptName === 'expense' || deptName === 'finance';
  }

  /** Expense Department stage gate: first-pass review and post-return resubmission. */
  async isExpenseDepartmentUser(userId) {
    const deptName = await this.getUserDepartmentName(userId);
    return deptName === 'expense';
  }

  /** Finance Department stage gate: second-pass review (approve or return). */
  async isFinanceDepartmentUser(userId) {
    const deptName = await this.getUserDepartmentName(userId);
    return deptName === 'finance';
  }

  /** Appends one audit entry to an expense's approvalHistory (in-memory; caller must save()). */
  pushApprovalHistory(expense, { action, byUserId, remark, stage }) {
    if (!Array.isArray(expense.approvalHistory)) {
      expense.approvalHistory = [];
    }
    expense.approvalHistory.push({
      action,
      byUserId: byUserId || undefined,
      remark: remark || undefined,
      stage,
      createdAt: new Date(),
    });
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

  /** In-flight statuses (not yet finally approved or rejected). */
  expensePendingStatuses() {
    return [
      'submitted',
      'tl-approved',
      'admin-approved',
      'expense-returned',
    ];
  }

  /** Existing rejection statuses in the Expense workflow. */
  expenseRejectedStatuses() {
    return ['tl-rejected', 'expense-rejected'];
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
      if (this.roundMoney(payload.amount) > MOBILE_BILL_FIXED_AMOUNT) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Mobile Bill amount cannot exceed Rs.${MOBILE_BILL_FIXED_AMOUNT}.`
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

    const minAllowedDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    minAllowedDate.setHours(0, 0, 0, 0);

    if (expenseDate < minAllowedDate) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Expense date must be within the current month or the previous month.'
      );
    }

    const userWithLeads = await User.findById(user.id)
      .select('teamLeadId subTeamLeadId team role')
      .populate('teamLeadId', 'role');
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
        name: payload.name,
        isDeleted: { $ne: true },
      });
      if (duplicateExpense) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'Duplicate expense detected for same date, type, amount, and name.'
        );
      }
    }

    await this.assertPhase2Policy(user, payload, expenseDate);

    const hasTeamLead = Boolean(
      userWithLeads.teamLeadId || userWithLeads.subTeamLeadId
    );
    const tlHasAdminRole =
      userWithLeads.teamLeadId &&
      String(userWithLeads.teamLeadId.role || '').toLowerCase() === 'admin';

    let status = hasTeamLead && !tlHasAdminRole ? 'submitted' : 'tl-approved';
    let tlId;
    let tlRemark;
    if (!hasTeamLead) {
      tlId = user.id;
      tlRemark =
        'Auto-routed to Expense Department because team lead is not mapped.';
    } else if (tlHasAdminRole) {
      tlId = userWithLeads.teamLeadId._id;
      tlRemark =
        'Auto-approved at TL stage because team lead has admin role.';
    }

    if (payload.type === 'Team Lunch') {
      status = 'tl-approved';
      tlId = undefined;
      tlRemark = 'Team Lunch: routed directly to Expense Department (policy).';
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
    const role = (user.role || '').toLowerCase();
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

        const teamUserIds = teamUsers.map((entry) => entry._id);
        if (filters.userId) {
          const requestedUserId = this.toObjectId(filters.userId);
          const allowed = teamUserIds.some(
            (id) => id.toString() === requestedUserId.toString()
          );
          if (!allowed) {
            throw new ApiError(
              httpStatus.FORBIDDEN,
              'You can only view expenses for your reportees.'
            );
          }
          query.userId = requestedUserId;
        } else {
          query.userId = { $in: teamUserIds };
        }
      }
    } else if (activeQueue === 'finance') {
      // Expense Department queue: team-scoped, Expense department or Admin.
      const isExpenseDeptUser = await this.isExpenseDepartmentUser(user.id);
      if (!(isFinalApproverAdminRole || isExpenseDeptUser)) {
        query.userId = this.toObjectId(user.id);
      } else {
        query.team = user.team;
      }
    } else if (activeQueue === 'finance-review') {
      // Finance Department queue: NOT scoped by team or userId — sees all employees.
      const isFinanceDeptUser = await this.isFinanceDepartmentUser(user.id);
      if (!(isFinalApproverAdminRole || isFinanceDeptUser)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Finance department or Admin can view the Finance review queue.'
        );
      }
    } else if (activeQueue === 'all') {
      // All Expenses: complete non-deleted dataset for the dedicated support account only.
      if (!this.isAllExpensesSupportUser(user)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'You are not authorized to view all expenses.'
        );
      }
      // No userId/team/status scope — filters below still apply when provided.
    } else {
      query.userId = this.toObjectId(user.id);
    }

    const statuses = this.splitCsvFilter(filters.status);
    const expenseQueueStatuses = [
      'tl-approved',
      'admin-approved',
      'expense-returned',
      'expense-approved',
      'expense-rejected',
    ];
    // Finance Review Fin. Status dropdown options only — "All" must match the dropdown.
    const financeQueueStatuses = [
      'admin-approved',
      'expense-returned',
      'expense-approved',
    ];

    if (statuses.length) {
      if (activeQueue === 'finance') {
        query.status = {
          $in: statuses.filter((s) => expenseQueueStatuses.includes(s)),
        };
      } else if (activeQueue === 'finance-review') {
        query.status = {
          $in: statuses.filter((s) => financeQueueStatuses.includes(s)),
        };
      } else {
        query.status = { $in: statuses };
      }
    } else if (activeQueue === 'finance') {
      query.status = { $in: expenseQueueStatuses };
    } else if (activeQueue === 'finance-review') {
      query.status = { $in: financeQueueStatuses };
    }

    const types = this.splitCsvFilter(filters.type);
    if (types.length) {
      query.type = { $in: types };
    }

    if (filters.fromDate || filters.toDate) {
      query.date = {};
      if (filters.fromDate) {
        const fromDate = new Date(filters.fromDate);
        fromDate.setHours(0, 0, 0, 0);
        query.date.$gte = fromDate;
      }
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
      {
        path: 'approvalHistory.byUserId',
        select: 'firstName lastName email employeeId role',
      },
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

  async updateExpenseStatus({
    expenseId,
    action,
    remark,
    currentUser,
    expectedStatus,
  }) {
    const expense = await Expense.findById(expenseId);
    if (!expense || expense.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found.');
    }

    const role = (currentUser.role || '').toLowerCase();
    const actorId = String(currentUser.id || currentUser._id || '');
    const isSuperAdmin = this.superAdminRoles.includes(role);
    const isTeamLead = this.tlRoles.includes(role);
    const isHr = role === 'hr';
    const isFinalApproverAdminRole = this.finalApproverAdminRoles.includes(role);
    const currentStatus = expense.status;

    // Optimistic lock: reject stale UI actions against a status that already moved.
    if (
      expectedStatus &&
      String(expectedStatus).toLowerCase() !== String(currentStatus).toLowerCase()
    ) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Expense status has changed to '${currentStatus}'. Refreshing latest status.`
      );
    }

    if (currentStatus === 'submitted') {
      // Dedicated support account may TL-approve or TL-reject submitted expenses.
      const isSupportActor = this.isAllExpensesSupportUser(currentUser);

      // Team Approvals: TL/SubTL, mapped HR lead, or Super Admin.
      // HR is included because the Team Approvals tab is shown to HR and HR
      // users are often mapped as teamLeadId for employees.
      if (!isSupportActor && !isSuperAdmin && !isTeamLead && !isHr) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Team Lead/Admin can action submitted expenses.'
        );
      }

      if (!isSupportActor) {
        const employee = await User.findById(expense.userId).select(
          'teamLeadId subTeamLeadId'
        );
        const isDirectLead =
          employee &&
          (employee.teamLeadId?.toString() === actorId ||
            employee.subTeamLeadId?.toString() === actorId);

        if (!isSuperAdmin && !isDirectLead) {
          throw new ApiError(
            httpStatus.FORBIDDEN,
            'You can only action expenses of your reportees.'
          );
        }
      }

      if (action === 'approved') {
        expense.status = 'tl-approved';
      } else if (action === 'rejected') {
        if (!remark) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Remark is required for rejection.'
          );
        }
        expense.status = 'tl-rejected';
      } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
      }

      expense.tlId = actorId;
      expense.tlRemark = remark || undefined;
      this.pushApprovalHistory(expense, {
        action,
        byUserId: actorId,
        remark,
        stage: 'team-lead',
      });
      return expense.save();
    }

    if (currentStatus === 'tl-approved' || currentStatus === 'expense-returned') {
      const isExpenseDeptUser = await this.isExpenseDepartmentUser(actorId);
      if (!(isFinalApproverAdminRole || isExpenseDeptUser)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Expense department or Admin can action this expense.'
        );
      }

      if (action === 'returned') {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
            'Expense Department cannot return an expense.'
        );
      }

      if (action === 'approved') {
        expense.status = 'admin-approved';
      } else if (action === 'rejected') {
        if (!remark) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Remark is required for rejection.'
          );
        }
        expense.status = 'expense-rejected';
      } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
      }

      expense.expenseRemark = remark || undefined;
      this.pushApprovalHistory(expense, {
        action,
        byUserId: actorId,
        remark,
        stage:
          currentStatus === 'expense-returned'
            ? 'expense-resubmit'
            : 'expense-review',
      });
      return expense.save();
    }

    if (currentStatus === 'admin-approved') {
      const isFinanceDeptUser = await this.isFinanceDepartmentUser(actorId);
      if (!(isFinalApproverAdminRole || isFinanceDeptUser)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Finance department or Admin can action this expense.'
        );
      }

      if (action === 'rejected') {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Finance Department cannot reject directly — use Return to Expense Department.'
        );
      }

      if (action === 'approved') {
        expense.status = 'expense-approved';
      } else if (action === 'returned') {
        if (!remark || remark.trim().length < 10) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'A remark of at least 10 characters is required to return an expense.'
          );
        }
        expense.status = 'expense-returned';
      } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
      }

      expense.financeRemark = remark || undefined;
      this.pushApprovalHistory(expense, {
        action,
        byUserId: actorId,
        remark,
        stage: 'finance-review',
      });
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

  buildExpenseDashboardDateRange(month, year) {
    const m = Number(month);
    const y = Number(year);
    const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(y, m, 0, 23, 59, 59, 999);
    return { startDate, endDate };
  }

  /** Map display team name (e.g. Sportsdunia) to stored team code (e.g. SD). */
  resolveDashboardTeamKey(teamInput) {
    const team = (teamInput || '').trim();
    if (!team) return team;

    const upper = team.toUpperCase();
    if (upper === 'SD' || upper === 'KAP') return upper;

    const stripQuotes = (value) => String(value || '').replace(/^"|"$/g, '').trim();
    const sdName = stripQuotes(process.env.TEAM_SD);
    const kapName = stripQuotes(process.env.TEAM_KAP);

    if (sdName && team.toLowerCase() === sdName.toLowerCase()) return 'SD';
    if (kapName && team.toLowerCase() === kapName.toLowerCase()) return 'KAP';

    return team;
  }

  resolveDashboardStatusFilter(status) {
    const statuses = this.splitCsvFilter(status);
    if (!statuses.length) return null;

    const mapped = [];
    for (const entry of statuses) {
      const normalized = entry.toLowerCase();
      if (normalized === 'approved') {
        mapped.push('expense-approved');
      } else if (normalized === 'pending') {
        mapped.push(...this.expensePendingStatuses());
      } else if (normalized === 'rejected') {
        mapped.push('expense-rejected');
      } else {
        mapped.push(entry);
      }
    }

    return [...new Set(mapped)];
  }

  async resolveExpenseDashboardAccess(user) {
    const role = (user.role || '').toLowerCase();
    const isTeamViewRole = this.expenseDashboardTeamViewRoles.includes(role);
    const isTlRole = this.tlRoles.includes(role);
    const isFinalApproverDeptUser = await this.isFinalApproverDepartmentUser(user.id);

    if (isTeamViewRole || isFinalApproverDeptUser) {
      return { scope: 'team', hasTeamView: true };
    }
    if (isTlRole) {
      return { scope: 'reportees', hasTeamView: true };
    }
    return { scope: 'self', hasTeamView: false };
  }

  async resolveDashboardEmployeeUserId(employeeId) {
    if (!employeeId) return null;

    if (mongoose.Types.ObjectId.isValid(employeeId)) {
      const byId = await User.findOne({
        _id: employeeId,
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      if (byId) return this.toObjectId(byId._id);
    }

    const byEmployeeCode = await User.findOne({
      employeeId: String(employeeId).trim(),
      isDeleted: { $ne: true },
    })
      .select('_id')
      .lean();

    if (!byEmployeeCode) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Employee not found.');
    }

    return this.toObjectId(byEmployeeCode._id);
  }

  async buildExpenseDashboardMatch(user, filters) {
    const { startDate, endDate } = this.buildExpenseDashboardDateRange(
      filters.month,
      filters.year
    );

    const match = {
      isDeleted: { $ne: true },
      date: { $gte: startDate, $lte: endDate },
    };

    const role = user.role;
    const isSuperAdminRole = this.superAdminRoles.includes(role);
    const access = await this.resolveExpenseDashboardAccess(user);

    const teamKey = this.resolveDashboardTeamKey(
      (filters.team || user.team || '').trim() || user.team
    );

    if (filters.employeeId) {
      match.userId = await this.resolveDashboardEmployeeUserId(filters.employeeId);
    } else if (access.scope === 'team') {
      match.team = teamKey;
    } else if (access.scope === 'reportees') {
      const reporteeQuery = {
        team: teamKey,
        isDeleted: { $ne: true },
      };

      if (!isSuperAdminRole) {
        reporteeQuery.$or = [
          { teamLeadId: user.id },
          { subTeamLeadId: user.id },
        ];
      }

      const reportees = await User.find(reporteeQuery).select('_id').lean();
      const reporteeIds = reportees.map((entry) => this.toObjectId(entry._id));

      if (!reporteeIds.length) {
        match.userId = { $in: [] };
      } else {
        match.userId = { $in: reporteeIds };
      }
    } else {
      match.userId = this.toObjectId(user.id);
    }

    const statuses = this.resolveDashboardStatusFilter(filters.status);
    if (statuses?.length) {
      match.status = { $in: statuses };
    }

    return match;
  }

  buildExpenseDashboardPipeline(match, page, limit, groupBy = 'employee') {
    const isDepartmentView = groupBy === 'department';
    const currentPage = Math.max(1, Number(page) || 1);
    const perPage = Math.max(1, Number(limit) || 10);
    const skip = (currentPage - 1) * perPage;
    const pendingStatuses = this.expensePendingStatuses();
    const approvedStatus = 'expense-approved';

    const summaryFacet = [
      {
        $group: {
          _id: null,
          employeeIds: { $addToSet: '$userId' },
          totalAppliedExpense: { $sum: '$amount' },
          totalApprovedExpense: {
            $sum: {
              $cond: [{ $eq: ['$status', approvedStatus] }, '$amount', 0],
            },
          },
          totalPendingExpense: {
            $sum: {
              $cond: [{ $in: ['$status', pendingStatuses] }, '$amount', 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalEmployees: { $size: '$employeeIds' },
          totalAppliedExpense: 1,
          totalApprovedExpense: 1,
          totalPendingExpense: 1,
        },
      },
    ];

    const groupByEmployeeAndType = {
      $group: {
        _id: {
          userId: '$userId',
          type: '$type',
          subCategory: {
            $let: {
              vars: {
                sc: { $trim: { input: { $ifNull: ['$subCategory', ''] } } },
                misc: { $trim: { input: { $ifNull: ['$miscellaneousType', ''] } } },
              },
              in: {
                $cond: [{ $ne: ['$$sc', ''] }, '$$sc', '$$misc'],
              },
            },
          },
        },
        applied: { $sum: '$amount' },
        approved: {
          $sum: {
            $cond: [{ $eq: ['$status', approvedStatus] }, '$amount', 0],
          },
        },
      },
    };

    const groupByEmployee = {
      $group: {
        _id: '$_id.userId',
        totalExpenseApplied: { $sum: '$applied' },
        totalExpenseApproved: { $sum: '$approved' },
        expensesByType: {
          $push: {
            type: '$_id.type',
            subCategory: '$_id.subCategory',
            applied: '$applied',
            approved: '$approved',
          },
        },
      },
    };

    const sortByAppliedDesc = { $sort: { totalExpenseApplied: -1 } };

    const joinEmployee = {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'employee',
      },
    };

    const unwindEmployee = {
      $unwind: { path: '$employee', preserveNullAndEmptyArrays: true },
    };

    const joinTeamLead = {
      $lookup: {
        from: 'users',
        let: {
          tlId: {
            $ifNull: ['$employee.teamLeadId', '$employee.subTeamLeadId'],
          },
        },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$tlId'] } } },
          { $project: { firstName: 1, lastName: 1 } },
        ],
        as: 'teamLead',
      },
    };

    const projectEmployeeRow = {
      $project: {
        _id: 0,
        employeeId: '$_id',
        kappId: { $ifNull: ['$employee.employeeId', ''] },
        employeeName: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ['$employee.firstName', ''] },
                ' ',
                { $ifNull: ['$employee.lastName', ''] },
              ],
            },
          },
        },
        designation: { $ifNull: ['$employee.jobTitle', ''] },
        team: { $ifNull: ['$employee.team', ''] },
        tlName: {
          $let: {
            vars: { tl: { $arrayElemAt: ['$teamLead', 0] } },
            in: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ['$$tl.firstName', ''] },
                    ' ',
                    { $ifNull: ['$$tl.lastName', ''] },
                  ],
                },
              },
            },
          },
        },
        totalExpenseApplied: 1,
        totalExpenseApproved: 1,
        expensesByType: 1,
      },
    };

    const joinEmployeeFromExpense = {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'employee',
      },
    };

    const unwindEmployeeFromExpense = {
      $unwind: { path: '$employee', preserveNullAndEmptyArrays: true },
    };

    const groupByDepartmentAndType = {
      $group: {
        _id: {
          departmentId: '$employee.department',
          type: '$type',
          subCategory: {
            $let: {
              vars: {
                sc: { $trim: { input: { $ifNull: ['$subCategory', ''] } } },
                misc: { $trim: { input: { $ifNull: ['$miscellaneousType', ''] } } },
              },
              in: {
                $cond: [{ $ne: ['$$sc', ''] }, '$$sc', '$$misc'],
              },
            },
          },
        },
        applied: { $sum: '$amount' },
        approved: {
          $sum: {
            $cond: [{ $eq: ['$status', approvedStatus] }, '$amount', 0],
          },
        },
        employeeIds: { $addToSet: '$userId' },
      },
    };

    const groupByDepartment = {
      $group: {
        _id: '$_id.departmentId',
        totalExpenseApplied: { $sum: '$applied' },
        totalExpenseApproved: { $sum: '$approved' },
        expensesByType: {
          $push: {
            type: '$_id.type',
            subCategory: '$_id.subCategory',
            applied: '$applied',
            approved: '$approved',
          },
        },
        employeeIds: { $push: '$employeeIds' },
      },
    };

    const addDepartmentEmployeeCount = {
      $addFields: {
        employeeCount: {
          $size: {
            $reduce: {
              input: '$employeeIds',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
        },
      },
    };

    const joinDepartment = {
      $lookup: {
        from: 'departments',
        localField: '_id',
        foreignField: '_id',
        as: 'department',
      },
    };

    const joinDepartmentTl = {
      $lookup: {
        from: 'users',
        let: { deptId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$department', '$$deptId'] },
                  { $in: ['$role', ['teamlead', 'subteamlead']] },
                  { $ne: ['$isDeleted', true] },
                ],
              },
            },
          },
          {
            $addFields: {
              rolePriority: {
                $cond: [{ $eq: ['$role', 'teamlead'] }, 0, 1],
              },
            },
          },
          { $sort: { rolePriority: 1, firstName: 1 } },
          {
            $project: {
              tlName: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$firstName', ''] },
                      ' ',
                      { $ifNull: ['$lastName', ''] },
                    ],
                  },
                },
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'departmentTl',
      },
    };

    const projectDepartmentRow = {
      $project: {
        _id: 0,
        departmentId: '$_id',
        departmentName: {
          $cond: {
            if: { $eq: ['$_id', null] },
            then: 'Unassigned',
            else: {
              $ifNull: [{ $arrayElemAt: ['$department.name', 0] }, 'Unassigned'],
            },
          },
        },
        tlName: {
          $ifNull: [{ $arrayElemAt: ['$departmentTl.tlName', 0] }, ''],
        },
        employeeCount: 1,
        totalExpenseApplied: 1,
        totalExpenseApproved: 1,
        expensesByType: 1,
      },
    };

    const employeeDataPipeline = [
      groupByEmployeeAndType,
      groupByEmployee,
      sortByAppliedDesc,
      { $skip: skip },
      { $limit: perPage },
      joinEmployee,
      unwindEmployee,
      joinTeamLead,
      projectEmployeeRow,
    ];

    const departmentDataPipeline = [
      joinEmployeeFromExpense,
      unwindEmployeeFromExpense,
      groupByDepartmentAndType,
      groupByDepartment,
      addDepartmentEmployeeCount,
      sortByAppliedDesc,
      { $skip: skip },
      { $limit: perPage },
      joinDepartment,
      joinDepartmentTl,
      projectDepartmentRow,
    ];

    const employeeMetaPipeline = [
      groupByEmployeeAndType,
      groupByEmployee,
      { $count: 'totalEmployees' },
    ];

    const departmentMetaPipeline = [
      joinEmployeeFromExpense,
      unwindEmployeeFromExpense,
      groupByDepartmentAndType,
      groupByDepartment,
      { $count: 'totalDepartments' },
    ];

    return {
      currentPage,
      perPage,
      groupBy,
      pipeline: [
        { $match: match },
        {
          $facet: {
            summary: summaryFacet,
            data: isDepartmentView ? departmentDataPipeline : employeeDataPipeline,
            meta: isDepartmentView ? departmentMetaPipeline : employeeMetaPipeline,
          },
        },
      ],
    };
  }

  formatExpenseDashboardMoney(value) {
    return this.roundMoney(value || 0);
  }

  formatExpenseDashboardRow(row) {
    return {
      employeeId: row.employeeId,
      kappId: row.kappId || '',
      employeeName: row.employeeName || '',
      designation: row.designation || '',
      team: row.team || '',
      tlName: row.tlName || '',
      totalExpenseApplied: this.formatExpenseDashboardMoney(row.totalExpenseApplied),
      totalExpenseApproved: this.formatExpenseDashboardMoney(row.totalExpenseApproved),
      expensesByType: (row.expensesByType || []).map((entry) => ({
        type: entry.type,
        subCategory: entry.subCategory || '',
        applied: this.formatExpenseDashboardMoney(entry.applied),
        approved: this.formatExpenseDashboardMoney(entry.approved),
      })),
    };
  }

  formatExpenseDashboardDepartmentRow(row) {
    return {
      departmentId: row.departmentId || null,
      departmentName: row.departmentName || 'Unassigned',
      tlName: row.tlName || '',
      employeeCount: row.employeeCount || 0,
      totalExpenseApplied: this.formatExpenseDashboardMoney(row.totalExpenseApplied),
      totalExpenseApproved: this.formatExpenseDashboardMoney(row.totalExpenseApproved),
      expensesByType: (row.expensesByType || []).map((entry) => ({
        type: entry.type,
        subCategory: entry.subCategory || '',
        applied: this.formatExpenseDashboardMoney(entry.applied),
        approved: this.formatExpenseDashboardMoney(entry.approved),
      })),
    };
  }

  async getExpenseDashboard(user, filters, page = 1, limit = 10) {
    const groupBy = filters.groupBy || 'employee';
    const isDepartmentView = groupBy === 'department';
    const access = await this.resolveExpenseDashboardAccess(user);
    const match = await this.buildExpenseDashboardMatch(user, filters);
    const { pipeline, currentPage, perPage } = this.buildExpenseDashboardPipeline(
      match,
      page,
      limit,
      groupBy
    );

    const [result] = await Expense.aggregate(pipeline);
    const summaryDoc = result?.summary?.[0] || {
      totalEmployees: 0,
      totalAppliedExpense: 0,
      totalApprovedExpense: 0,
      totalPendingExpense: 0,
    };
    const totalDocs = isDepartmentView
      ? result?.meta?.[0]?.totalDepartments || 0
      : result?.meta?.[0]?.totalEmployees || 0;
    const totalPages = Math.ceil(totalDocs / perPage) || 0;

    const summary = {
      totalEmployees: summaryDoc.totalEmployees || 0,
      totalAppliedExpense: this.formatExpenseDashboardMoney(
        summaryDoc.totalAppliedExpense
      ),
      totalApprovedExpense: this.formatExpenseDashboardMoney(
        summaryDoc.totalApprovedExpense
      ),
      totalPendingExpense: this.formatExpenseDashboardMoney(
        summaryDoc.totalPendingExpense
      ),
    };

    if (isDepartmentView) {
      summary.totalDepartments = totalDocs;
    }

    const formatRow = isDepartmentView
      ? (row) => this.formatExpenseDashboardDepartmentRow(row)
      : (row) => this.formatExpenseDashboardRow(row);

    return {
      summary,
      data: (result?.data || []).map(formatRow),
      pagination: {
        totalDocs,
        limit: perPage,
        totalPages,
        currentPage,
        pagingCounter: totalDocs ? (currentPage - 1) * perPage + 1 : 0,
        hasPrevPage: currentPage > 1,
        hasNextPage: currentPage < totalPages,
        prevPage: currentPage > 1 ? currentPage - 1 : null,
        nextPage: currentPage < totalPages ? currentPage + 1 : null,
      },
      filters: {
        month: Number(filters.month),
        year: Number(filters.year),
        team: filters.team || null,
        employeeId: filters.employeeId || null,
        status: filters.status || null,
        groupBy,
      },
      access,
    };
  }

  /**
   * Personal My Dashboard — authenticated employee only.
   * Read-only aggregates; never accepts a client-supplied employee id.
   */
  async getMyExpenseDashboard(user) {
    if (!user?.id) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Could not identify user.');
    }

    const userId = this.toObjectId(user.id);
    const pendingStatuses = this.expensePendingStatuses();
    const rejectedStatuses = this.expenseRejectedStatuses();
    const approvedStatus = 'expense-approved';

    const now = new Date();
    const monthKeys = [];
    for (let i = 5; i >= 0; i -= 1) {
      const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push({
        year: cursor.getFullYear(),
        month: cursor.getMonth() + 1,
      });
    }
    const first = monthKeys[0];
    const last = monthKeys[monthKeys.length - 1];
    const rangeStart = new Date(first.year, first.month - 1, 1, 0, 0, 0, 0);
    const rangeEnd = new Date(last.year, last.month, 0, 23, 59, 59, 999);

    const match = {
      userId,
      isDeleted: { $ne: true },
    };

    const [facet] = await Expense.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                appliedAmount: { $sum: '$amount' },
                appliedCount: { $sum: 1 },
                approvedAmount: {
                  $sum: {
                    $cond: [{ $eq: ['$status', approvedStatus] }, '$amount', 0],
                  },
                },
                approvedCount: {
                  $sum: {
                    $cond: [{ $eq: ['$status', approvedStatus] }, 1, 0],
                  },
                },
                pendingAmount: {
                  $sum: {
                    $cond: [
                      { $in: ['$status', pendingStatuses] },
                      '$amount',
                      0,
                    ],
                  },
                },
                pendingCount: {
                  $sum: {
                    $cond: [{ $in: ['$status', pendingStatuses] }, 1, 0],
                  },
                },
                rejectedAmount: {
                  $sum: {
                    $cond: [
                      { $in: ['$status', rejectedStatuses] },
                      '$amount',
                      0,
                    ],
                  },
                },
                rejectedCount: {
                  $sum: {
                    $cond: [{ $in: ['$status', rejectedStatuses] }, 1, 0],
                  },
                },
              },
            },
          ],
          monthly: [
            {
              $match: {
                date: { $gte: rangeStart, $lte: rangeEnd },
              },
            },
            {
              $group: {
                _id: {
                  year: { $year: { date: '$date', timezone: 'Asia/Kolkata' } },
                  month: { $month: { date: '$date', timezone: 'Asia/Kolkata' } },
                },
                applied: { $sum: '$amount' },
                approved: {
                  $sum: {
                    $cond: [{ $eq: ['$status', approvedStatus] }, '$amount', 0],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const totalsDoc = facet?.totals?.[0] || {};
    const monthlyMap = new Map(
      (facet?.monthly || []).map((row) => [
        `${row._id.year}-${row._id.month}`,
        row,
      ])
    );

    const monthly = monthKeys.map((key) => {
      const row = monthlyMap.get(`${key.year}-${key.month}`);
      return {
        year: key.year,
        month: key.month,
        applied: this.formatExpenseDashboardMoney(row?.applied),
        approved: this.formatExpenseDashboardMoney(row?.approved),
      };
    });

    return {
      applied: {
        amount: this.formatExpenseDashboardMoney(totalsDoc.appliedAmount),
        count: totalsDoc.appliedCount || 0,
      },
      approved: {
        amount: this.formatExpenseDashboardMoney(totalsDoc.approvedAmount),
        count: totalsDoc.approvedCount || 0,
      },
      pending: {
        amount: this.formatExpenseDashboardMoney(totalsDoc.pendingAmount),
        count: totalsDoc.pendingCount || 0,
      },
      rejected: {
        amount: this.formatExpenseDashboardMoney(totalsDoc.rejectedAmount),
        count: totalsDoc.rejectedCount || 0,
      },
      monthly,
    };
  }

  /**
   * Team Lead Bulk Approve summary: one row per reportee per calendar month
   * for expenses still in `submitted` status. Team Lead role only.
   */
  async getTlBulkSummary(user, filters = {}) {
    const role = (user.role || '').toLowerCase();
    // Align with frontend Bulk Approve tab: Team Lead + HR (not Sub Team Lead).
    if (role !== 'teamlead' && role !== 'hr') {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only Team Lead or HR users can access Bulk Approve summary.'
      );
    }

    const teamUsers = await User.find(
      {
        team: user.team,
        $or: [{ teamLeadId: user.id }, { subTeamLeadId: user.id }],
        isDeleted: { $ne: true },
      },
      '_id firstName lastName employeeId'
    ).lean();

    const teamUserIds = teamUsers.map((u) => u._id);
    if (teamUserIds.length === 0) {
      return { data: [] };
    }

    const match = {
      isDeleted: { $ne: true },
      status: 'submitted',
      userId: { $in: teamUserIds },
    };

    const month = filters.month != null ? Number(filters.month) : null;
    const year = filters.year != null ? Number(filters.year) : null;

    if (month && year) {
      const fromDate = new Date(year, month - 1, 1);
      const toDate = new Date(year, month, 0, 23, 59, 59, 999);
      match.date = { $gte: fromDate, $lte: toDate };
    } else if (year && !month) {
      const fromDate = new Date(year, 0, 1);
      const toDate = new Date(year, 11, 31, 23, 59, 59, 999);
      match.date = { $gte: fromDate, $lte: toDate };
    }

    const rows = await Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            userId: '$userId',
            year: { $year: { date: '$date', timezone: 'Asia/Kolkata' } },
            month: { $month: { date: '$date', timezone: 'Asia/Kolkata' } },
          },
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          expenses: {
            $push: {
              id: '$_id',
              amount: '$amount',
            },
          },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1, totalAmount: -1 } },
    ]);

    const userMap = new Map(
      teamUsers.map((u) => [u._id.toString(), u])
    );

    const data = rows.map((row) => {
      const uid = row._id.userId.toString();
      const emp = userMap.get(uid);
      const expenses = (row.expenses || []).map((e) => ({
        id: e.id.toString(),
        amount: e.amount,
      }));
      return {
        userId: uid,
        employeeId: emp?.employeeId || '—',
        employeeName: emp
          ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
          : '—',
        month: row._id.month,
        year: row._id.year,
        totalAmount: row.totalAmount,
        count: row.count,
        expenseIds: expenses.map((e) => e.id),
        expenses,
      };
    });

    return { data };
  }
}

module.exports = new ExpenseService();
