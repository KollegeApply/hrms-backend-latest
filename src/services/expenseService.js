const { default: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../utility/ApiError');
const logger = require('../config/logger');
const Expense = require('../models/expenseModel');
const User = require('../models/userModel');
const Department = require('../models/departmentModel');
const ExpenseFilingCutoff = require('../models/expenseFilingCutoffModel');
const {
  TEAM_LUNCH_PER_ATTENDEE,
  MOBILE_BILL_FIXED_AMOUNT,
  ATTACHMENT_THRESHOLD_AMOUNT,
  FOOD_DAILY_CAP,
  HOTEL_PER_NIGHT_CAP,
  travelPerKmRate,
  TL_ROLES_FOR_TEAM_LUNCH,
  TRIP_CONTEXTS,
  BASE_LOCATION_TRAVEL_PER_MEETING_CAP,
  BASE_LOCATION_TRAVEL_MONTHLY_CAP,
  DEFAULT_EXPENSE_FILING_CUTOFF_MESSAGE,
  EXPENSE_POLICY_TAGS,
  EXPENSE_POLICY_TAG_VALUES,
  MONTHLY_EXPENSE_BUDGET,
} = require('../utility/expensePolicyConstants');

/** Special support account allowed to view All Expenses and TL-approve/reject submitted rows. */
const ALL_EXPENSES_SUPPORT_EMAIL = 'support@kollegeapply.com';

class ExpenseService {
  constructor() {
    this.adminRoles = ['admin', 'subadmin', 'hr'];
    this.superAdminRoles = ['admin', 'subadmin'];
    this.tlRoles = ['teamlead', 'subteamlead'];
    this.finalApproverAdminRoles = ['admin'];
    /** Populate paths for Finance "Raise an Issue" authors. */
    this.financeIssuePopulatePaths = [
      { path: 'financeIssues.raisedBy', select: 'firstName lastName email employeeId role' },
    ];
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

  /** Sales Expense carries KAPP ID / Institute Name; Normal Expense never does. */
  isSalesExpense(payload) {
    return payload.expenseCategory !== 'normal';
  }

  /** Travel, Food, Team Lunch, and Miscellaneous > Hotel Accommodation — the attendee-eligible types. */
  isAttendeeEligibleType(payload) {
    return (
      payload.type === 'Travel' ||
      payload.type === 'Food' ||
      payload.type === 'Team Lunch' ||
      (payload.type === 'Miscellaneous' && payload.subCategory === 'Hotel Accommodation')
    );
  }

  /** In-flight statuses (not yet finally approved or rejected). */
  expensePendingStatuses() {
    return [
      'submitted',
      'tl-approved',
      'zonal-pending',
      'zonal-approved',
      'admin-approved',
      'expense-returned',
    ];
  }

  /** Existing rejection statuses in the Expense workflow. */
  expenseRejectedStatuses() {
    return ['tl-rejected', 'zonal-rejected', 'expense-rejected'];
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
              { case: { $eq: ['$status', 'zonal-approved'] }, then: 2 },
              { case: { $eq: ['$status', 'submitted'] }, then: 3 },
            ]
            : [
              { case: { $eq: ['$status', 'submitted'] }, then: 1 },
              { case: { $eq: ['$status', 'tl-approved'] }, then: 2 },
              { case: { $eq: ['$status', 'zonal-approved'] }, then: 2 },
            ]),
        ],
        default: requesterRole === 'hr' ? 4 : 3,
      },
    };
  }

  /**
   * Validates a claim against Phase 2 policy and classifies it.
   *
   * Structural rules (who may claim what, derived amounts, duplicates,
   * attachments) still throw — they make a claim invalid. Spend *caps* no
   * longer throw: the claimant was warned before submitting and chose to
   * continue, so each broken cap is collected and the claim is returned
   * tagged out-of-policy for the approver to judge.
   *
   * @param {string} [expenseId] the row being resubmitted, excluded from
   *   running totals so an edit never counts its own old amount twice.
   * @returns {Promise<{ policyTag: string, policyBreaches: object[] }>}
   */
  async assertPhase2Policy(user, payload, expenseDate, expenseId) {
    const submitter = await User.findById(user.id)
      .select('team teamLeadId subTeamLeadId role expenseBand')
      .lean();
    if (!submitter) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const band = this.resolveExpenseBand(submitter.expenseBand);
    const teamName = submitter.team || user.team;
    const breaches = [];
    const addBreach = (rule, label, capAmount, enteredAmount, message) => {
      breaches.push({
        rule,
        label,
        capAmount: this.roundMoney(capAmount),
        enteredAmount: this.roundMoney(enteredAmount),
        message,
      });
    };
    const excludeSelf = expenseId
      ? { _id: { $ne: this.toObjectId(expenseId) } }
      : {};

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
    } else if (
      this.isAttendeeEligibleType(payload) &&
      Array.isArray(payload.attendeeUserIds) &&
      payload.attendeeUserIds.length
    ) {
      // Travel / Food / Hotel Accommodation — attendees may be from any
      // team (not just the filer's own), so only existence is checked here.
      const ids = [...new Set(payload.attendeeUserIds.map(String))];
      const attendees = await User.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      if (attendees.length !== ids.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'One or more attendee users are invalid.');
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
      const mobileAmount = this.roundMoney(payload.amount);
      if (mobileAmount > MOBILE_BILL_FIXED_AMOUNT) {
        addBreach(
          'mobile-bill-monthly',
          'Mobile Bill monthly limit',
          MOBILE_BILL_FIXED_AMOUNT,
          mobileAmount,
          `Claimed Rs.${mobileAmount} against a monthly Mobile Bill limit of Rs.${MOBILE_BILL_FIXED_AMOUNT}.`
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

      if (payload.tripContext === TRIP_CONTEXTS.BASE_LOCATION) {
        const perMeetingCap = BASE_LOCATION_TRAVEL_PER_MEETING_CAP[band];
        if (perMeetingCap != null && Number(payload.amount) > perMeetingCap) {
          addBreach(
            'base-location-travel-per-meeting',
            'Base location (Intracity) travel per-meeting cap',
            perMeetingCap,
            payload.amount,
            `Claimed Rs.${this.roundMoney(payload.amount)} against a per-meeting cap of Rs.${perMeetingCap} for band ${band}.`
          );
        }

        const y = expenseDate.getFullYear();
        const m = expenseDate.getMonth();
        const monthStart = new Date(y, m, 1);
        const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
        // "Approved/created" per PRD = anything not yet rejected (still in-flight or fully approved).
        const relevantStatuses = [
          ...this.expensePendingStatuses(),
          'expense-approved',
        ];

        const monthToDate = await Expense.find({
          ...excludeSelf,
          userId: this.toObjectId(user.id),
          type: 'Travel',
          tripContext: TRIP_CONTEXTS.BASE_LOCATION,
          date: { $gte: monthStart, $lte: monthEnd },
          status: { $in: relevantStatuses },
          isDeleted: { $ne: true },
        })
          .select('amount')
          .lean();

        const existingSum = monthToDate.reduce(
          (sum, entry) => sum + Number(entry.amount || 0),
          0
        );
        const projectedTotal = this.roundMoney(existingSum + Number(payload.amount));
        if (projectedTotal > BASE_LOCATION_TRAVEL_MONTHLY_CAP) {
          addBreach(
            'base-location-travel-monthly',
            'Base location (Intracity) travel monthly cap',
            BASE_LOCATION_TRAVEL_MONTHLY_CAP,
            projectedTotal,
            `Takes this month's Base location (Intracity) travel total to Rs.${projectedTotal}, against a monthly cap of Rs.${BASE_LOCATION_TRAVEL_MONTHLY_CAP}.`
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
        ...excludeSelf,
        userId: this.toObjectId(user.id),
        type: 'Food',
        subCategory: payload.subCategory,
        date: expenseDate,
        isDeleted: { $ne: true },
      })
        .select('amount')
        .lean();
      const existingSum = sameDay.reduce((s, e) => s + Number(e.amount || 0), 0);
      const total = this.roundMoney(existingSum + Number(payload.amount));
      if (total > daily) {
        addBreach(
          'food-daily',
          `Food (${payload.subCategory}) daily cap`,
          daily,
          total,
          existingSum > 0
            ? `Takes this date's Food (${payload.subCategory}) total to Rs.${total}, against a daily cap of Rs.${daily}.`
            : `Claimed Rs.${total} against a daily Food (${payload.subCategory}) cap of Rs.${daily}.`
        );
      }
    }

    if (payload.type === 'Miscellaneous' && payload.subCategory === 'Hotel Accommodation') {
      const tierKey = payload.cityTier === 'Metro' ? 'metro' : 'nonMetro';
      const cap = HOTEL_PER_NIGHT_CAP[band]?.[tierKey];
      if (cap == null) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid hotel city tier.');
      }
      if (Number(payload.amount) > cap) {
        addBreach(
          'hotel-per-night',
          `Hotel Accommodation (${payload.cityTier}) per-night cap`,
          cap,
          payload.amount,
          `Claimed Rs.${this.roundMoney(payload.amount)} against a per-night cap of Rs.${cap} for band ${band} (${payload.cityTier}).`
        );
      }
    }

    if (this.requiresAttachment(payload) && !this.hasAttachmentUrl(payload)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Attachment is required for this expense (policy: amount ≥ Rs.150 and/or this expense type).'
      );
    }

    return {
      policyTag: breaches.length
        ? EXPENSE_POLICY_TAGS.OUT_OF_POLICY
        : EXPENSE_POLICY_TAGS.IN_POLICY,
      policyBreaches: breaches,
    };
  }

  /** Singleton settings doc — created lazily with safe (filing-open) defaults. */
  async getOrCreateExpenseFilingCutoff() {
    let doc = await ExpenseFilingCutoff.findOne({ key: 'global' });
    if (!doc) {
      doc = await ExpenseFilingCutoff.create({
        key: 'global',
        cutoffActive: false,
        scope: 'all',
        departmentIds: [],
      });
    }
    return doc;
  }

  /** Public read (any authenticated user) — drives whether Add Expense is disabled client-side. */
  async getExpenseFilingCutoffStatus() {
    const doc = await this.getOrCreateExpenseFilingCutoff();
    await doc.populate('updatedBy', 'firstName lastName email');
    return {
      cutoffActive: doc.cutoffActive,
      scope: doc.scope,
      departmentIds: (doc.departmentIds || []).map((id) => id.toString()),
      message: doc.message || DEFAULT_EXPENSE_FILING_CUTOFF_MESSAGE,
      updatedBy: doc.updatedBy || null,
      updatedAt: doc.updatedAt,
    };
  }

  /** FR-1.1/1.2 — Expense department only. Validates scope/departments and appends an audit history entry. */
  async updateExpenseFilingCutoff(currentUser, payload) {
    const isExpenseDeptUser = await this.isExpenseDepartmentUser(currentUser.id);
    if (!isExpenseDeptUser) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only the Expense department can change the expense filing cutoff.'
      );
    }

    const scope = payload.scope === 'departments' ? 'departments' : 'all';
    let departmentIds = [];
    if (scope === 'departments') {
      const ids = [...new Set((payload.departmentIds || []).map(String))];
      if (ids.length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Select at least one department, or choose All Employees.'
        );
      }
      const found = await Department.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      if (found.length !== ids.length) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'One or more selected departments are invalid.'
        );
      }
      departmentIds = ids.map((id) => this.toObjectId(id));
    }

    const doc = await this.getOrCreateExpenseFilingCutoff();
    doc.cutoffActive = Boolean(payload.cutoffActive);
    doc.scope = scope;
    doc.departmentIds = departmentIds;
    doc.message = payload.message?.trim() || undefined;
    doc.updatedBy = currentUser.id;
    doc.history.push({
      cutoffActive: doc.cutoffActive,
      scope: doc.scope,
      departmentIds: doc.departmentIds,
      message: doc.message,
      changedBy: currentUser.id,
      changedAt: new Date(),
    });
    await doc.save();

    return this.getExpenseFilingCutoffStatus();
  }

  /** Expense department only — audit trail for the filing cutoff, newest first. */
  async getExpenseFilingCutoffHistory(currentUser) {
    const isExpenseDeptUser = await this.isExpenseDepartmentUser(currentUser.id);
    if (!isExpenseDeptUser) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only the Expense department can view the expense filing cutoff history.'
      );
    }

    const doc = await ExpenseFilingCutoff.findOne({ key: 'global' })
      .populate('history.changedBy', 'firstName lastName email')
      .populate('history.departmentIds', 'name')
      .lean();

    const history = [...(doc?.history || [])].sort(
      (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
    );
    return { history };
  }

  /** Enforcement — throws if the submitter is currently blocked from filing new expenses. */
  async assertExpenseFilingAllowed(user) {
    const doc = await this.getOrCreateExpenseFilingCutoff();
    if (!doc.cutoffActive) return;

    const blockMessage = doc.message || DEFAULT_EXPENSE_FILING_CUTOFF_MESSAGE;

    if (doc.scope === 'all') {
      throw new ApiError(httpStatus.FORBIDDEN, blockMessage);
    }

    const submitter = await User.findById(user.id).select('department').lean();
    const submitterDeptId = submitter?.department ? String(submitter.department) : null;
    const blockedDeptIds = (doc.departmentIds || []).map((id) => String(id));
    if (submitterDeptId && blockedDeptIds.includes(submitterDeptId)) {
      throw new ApiError(httpStatus.FORBIDDEN, blockMessage);
    }
  }

  async createExpense(user, payload) {
    await this.assertExpenseFilingAllowed(user);

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

    if (
      payload.type === 'Travel' &&
      payload.tripContext === TRIP_CONTEXTS.BASE_LOCATION &&
      String(payload.kappId || '').trim()
    ) {
      // A KAPP ID + date represents one real-world meeting. The first user
      // to claim it "owns" it and may file further expenses against the
      // same KAPP ID + date; anyone else is blocked from claiming it too.
      // Base location (Intracity) only — Outstation (Intercity) is exempt.
      // Normal Expense Travel never carries a KAPP ID, so it's exempt too.
      const kappId = String(payload.kappId || '').trim();
      const existingTravel = await Expense.findOne({
        type: 'Travel',
        tripContext: TRIP_CONTEXTS.BASE_LOCATION,
        date: expenseDate,
        kappId,
        isDeleted: { $ne: true },
      }).lean();
      if (existingTravel && String(existingTravel.userId) !== String(user.id)) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'A travel expense already exists for this date and KAPP ID.'
        );
      }
    }

    const { policyTag, policyBreaches } = await this.assertPhase2Policy(
      user,
      payload,
      expenseDate
    );

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
      this.isAttendeeEligibleType(payload) && Array.isArray(payload.attendeeUserIds)
        ? [...new Set(payload.attendeeUserIds.map((id) => this.toObjectId(id)))]
        : undefined;

    const expense = await Expense.create({
      userId: user.id,
      team: teamKey,
      date: expenseDate,
      name: payload.name,
      type: payload.type,
      expenseCategory: this.isSalesExpense(payload) ? 'sales' : 'normal',
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
      // KAPP ID / Institute Name apply only under Sales Expense — Normal
      // Expense never carries either field. Under Sales Expense they're kept
      // regardless of type so any line can join a draft group.
      kappId: this.isSalesExpense(payload) ? String(payload.kappId || '').trim() : undefined,
      instituteName: this.isSalesExpense(payload)
        ? String(payload.instituteName || '').trim()
        : undefined,
      tripContext: payload.type === 'Travel' ? payload.tripContext : undefined,
      amount: Number(payload.amount),
      purpose: payload.purpose,
      attachmentUrl: payload.attachmentUrl || undefined,
      policyTag,
      policyBreaches,
      status,
      tlId,
      tlRemark,
      isDraft: Boolean(payload.isDraft),
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

  /**
   * FR-3.2 — claimant edits a rejected expense in place and resubmits it.
   * Keeps the same record id; status returns to the pending stage the
   * (edited) content routes to, and the prior rejection stays visible via
   * `approvalHistory` (never cleared, only appended to).
   */
  async updateExpense(user, expenseId, payload) {
    const expense = await Expense.findById(expenseId);
    if (!expense || expense.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found.');
    }

    if (expense.userId.toString() !== user.id.toString()) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'You can only edit your own expenses.'
      );
    }

    if (!expense.isDraft && !this.expenseRejectedStatuses().includes(expense.status)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Expense in '${expense.status}' state cannot be edited. Only rejected expenses can be edited.`
      );
    }

    await this.assertExpenseFilingAllowed(user);

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

    const userWithLeads = await User.findById(user.id)
      .select('teamLeadId subTeamLeadId team role')
      .populate('teamLeadId', 'role');
    if (!userWithLeads) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const teamKey = userWithLeads.team || user.team;

    if (payload.type === 'Team Lunch') {
      const dupTeam = await Expense.findOne({
        _id: { $ne: expense._id },
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
        _id: { $ne: expense._id },
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

    if (
      payload.type === 'Travel' &&
      payload.tripContext === TRIP_CONTEXTS.BASE_LOCATION &&
      String(payload.kappId || '').trim()
    ) {
      // Same ownership rule as createExpense: whoever first claimed this
      // KAPP ID + date may keep filing against it; anyone else is blocked.
      // Normal Expense Travel never carries a KAPP ID, so it's exempt too.
      const kappId = String(payload.kappId || '').trim();
      const existingTravel = await Expense.findOne({
        _id: { $ne: expense._id },
        type: 'Travel',
        tripContext: TRIP_CONTEXTS.BASE_LOCATION,
        date: expenseDate,
        kappId,
        isDeleted: { $ne: true },
      }).lean();
      if (existingTravel && String(existingTravel.userId) !== String(user.id)) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'A travel expense already exists for this date and KAPP ID.'
        );
      }
    }

    const { policyTag, policyBreaches } = await this.assertPhase2Policy(
      user,
      payload,
      expenseDate,
      expense._id
    );

    // Zonal Head already reviewed and rejected this one — Team Lead already
    // approved it earlier and is not shown it again on resubmission. Only
    // the Zonal Head who rejected it reviews the correction.
    const wasZonalRejected = expense.status === 'zonal-rejected';

    const hasTeamLead = Boolean(
      userWithLeads.teamLeadId || userWithLeads.subTeamLeadId
    );
    const tlHasAdminRole =
      userWithLeads.teamLeadId &&
      String(userWithLeads.teamLeadId.role || '').toLowerCase() === 'admin';

    let status;
    let tlId;
    let tlRemark;

    if (wasZonalRejected) {
      status = 'zonal-pending';
      tlId = expense.tlId;
      tlRemark = expense.tlRemark;
    } else {
      status = hasTeamLead && !tlHasAdminRole ? 'submitted' : 'tl-approved';
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
    }

    const attendeeIds =
      this.isAttendeeEligibleType(payload) && Array.isArray(payload.attendeeUserIds)
        ? [...new Set(payload.attendeeUserIds.map((id) => this.toObjectId(id)))]
        : undefined;

    try {
      expense.team = teamKey;
      expense.date = expenseDate;
      expense.name = payload.name;
      expense.type = payload.type;
      expense.expenseCategory = this.isSalesExpense(payload) ? 'sales' : 'normal';
      expense.subCategory = payload.subCategory || undefined;
      expense.miscellaneousType = payload.miscellaneousType || undefined;
      expense.distanceKm =
        payload.type === 'Travel' &&
        (payload.subCategory === '2 Wheeler' || payload.subCategory === '4 Wheeler')
          ? Number(payload.distanceKm)
          : undefined;
      expense.clientName = payload.clientName?.trim() || undefined;
      expense.clientPocName = payload.clientPocName?.trim() || undefined;
      expense.clientPocDesignation = payload.clientPocDesignation?.trim() || undefined;
      expense.attendeeUserIds = attendeeIds;
      expense.miscOthersDescription = payload.miscOthersDescription?.trim() || undefined;
      expense.travelMiscDescription = payload.travelMiscDescription?.trim() || undefined;
      expense.cityTier = payload.cityTier || undefined;
      expense.kappId = this.isSalesExpense(payload)
        ? String(payload.kappId || '').trim()
        : undefined;
      expense.instituteName = this.isSalesExpense(payload)
        ? String(payload.instituteName || '').trim()
        : undefined;
      expense.tripContext = payload.type === 'Travel' ? payload.tripContext : undefined;
      expense.amount = Number(payload.amount);
      expense.purpose = payload.purpose;
      expense.attachmentUrl = payload.attachmentUrl || undefined;
      expense.policyTag = policyTag;
      expense.policyBreaches = policyBreaches;
      expense.status = status;
      expense.tlId = tlId;
      expense.tlRemark = tlRemark;
      expense.expenseRemark = undefined;

      // Editing a draft line just updates its content — it stays a draft
      // until the whole group is submitted via submitExpenseDrafts().
      if (!expense.isDraft) {
        this.pushApprovalHistory(expense, {
          action: 'resubmitted',
          byUserId: user.id,
          stage: 'employee',
        });
      }

      await expense.save();
    } catch (err) {
      throw err;
    }

    return Expense.findById(expense._id).populate([
      {
        path: 'userId',
        select:
          'firstName lastName employeeId email role teamLeadId subTeamLeadId expenseBand',
      },
      { path: 'tlId', select: 'firstName lastName employeeId email role' },
      { path: 'attendeeUserIds', select: 'firstName lastName employeeId email' },
      { path: 'approvalHistory.byUserId', select: 'firstName lastName email employeeId role' },
    ]);
  }

  async getExpenses(user, filters, page = 1, limit = 10) {
    // Drafts have their own tab (getExpenseDrafts) — never mixed into any
    // approval/dashboard/"my expenses" queue.
    const query = { isDeleted: { $ne: true }, isDraft: { $ne: true } };
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
    } else if (activeQueue === 'zonal') {
      // Zonal Head queue: only expenses filed by employees mapped to this
      // Zonal Head (User.zonalHeadId). Super Admin sees every zonal queue.
      if (!isSuperAdminRole) {
        const mappedUsers = await User.find(
          { zonalHeadId: user.id, isDeleted: { $ne: true } },
          '_id'
        );
        const mappedUserIds = mappedUsers.map((entry) => entry._id);
        query.userId = mappedUserIds.length ? { $in: mappedUserIds } : { $in: [] };
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
    } else if (activeQueue === 'finance-issues') {
      // Finance "Raised Issues" view: every claim Finance has raised an issue
      // on, across all employees and statuses — same audience as Finance Review.
      const isFinanceDeptUser = await this.isFinanceDepartmentUser(user.id);
      if (!(isSuperAdminRole || isFinanceDeptUser)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Finance department or Admin can view raised issues.'
        );
      }
      query.hasFinanceIssue = true;
    } else if (activeQueue === 'all') {
      // All Expenses: complete non-deleted dataset — the dedicated support
      // account, or anyone in the Expense department.
      const isExpenseDeptUser = await this.isExpenseDepartmentUser(user.id);
      if (!this.isAllExpensesSupportUser(user) && !isExpenseDeptUser) {
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
      'zonal-approved',
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

    // In-policy / out-of-policy tag filter. Rows predating the policy tag
    // carry no field at all, so "in policy" has to include the missing case.
    const policyTags = this.splitCsvFilter(filters.policyTag);
    if (policyTags.length && policyTags.length < EXPENSE_POLICY_TAG_VALUES.length) {
      query.policyTag = policyTags.includes(EXPENSE_POLICY_TAGS.IN_POLICY)
        ? { $ne: EXPENSE_POLICY_TAGS.OUT_OF_POLICY }
        : { $in: policyTags };
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
      ...this.financeIssuePopulatePaths,
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

    if (expense.isDraft) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This expense is still a draft. Submit it before it can be actioned.'
      );
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

      let employeeZonalHeadId = null;
      if (!isSupportActor) {
        const employee = await User.findById(expense.userId).select(
          'teamLeadId subTeamLeadId zonalHeadId'
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
        employeeZonalHeadId = employee?.zonalHeadId
          ? String(employee.zonalHeadId)
          : null;
      } else {
        const employee = await User.findById(expense.userId).select('zonalHeadId');
        employeeZonalHeadId = employee?.zonalHeadId
          ? String(employee.zonalHeadId)
          : null;
      }

      if (action === 'approved') {
        // A mapped Zonal Head must review next — unless the same person
        // acting here IS that Zonal Head, in which case this one approval
        // covers both stages.
        const approverIsZonalHead =
          employeeZonalHeadId && employeeZonalHeadId === actorId;
        expense.status =
          employeeZonalHeadId && !approverIsZonalHead
            ? 'zonal-pending'
            : 'tl-approved';
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

    // Zonal Head stage — only reached for filers with a mapped zonalHeadId
    // (see the 'submitted' block above). Mandatory: the expense cannot move
    // to the Expense department until the Zonal Head approves it here.
    if (currentStatus === 'zonal-pending') {
      const isSupportActor = this.isAllExpensesSupportUser(currentUser);

      if (!isSupportActor && !isSuperAdmin) {
        const employee = await User.findById(expense.userId).select('zonalHeadId');
        const isMappedZonalHead =
          employee?.zonalHeadId && employee.zonalHeadId.toString() === actorId;

        if (!isMappedZonalHead) {
          throw new ApiError(
            httpStatus.FORBIDDEN,
            'Only the mapped Zonal Head can action this expense.'
          );
        }
      }

      if (action === 'approved') {
        expense.status = 'zonal-approved';
      } else if (action === 'rejected') {
        if (!remark) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Remark is required for rejection.'
          );
        }
        expense.status = 'zonal-rejected';
      } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
      }

      this.pushApprovalHistory(expense, {
        action,
        byUserId: actorId,
        remark,
        stage: 'zonal-head',
      });
      return expense.save();
    }

    // Expense Department is the final approver. Finance keeps read/export
    // access but can no longer approve, reject or return — `admin-approved`
    // is accepted here only so rows left in Finance's old queue can still be
    // finalised by the Expense Department.
    if (
      currentStatus === 'tl-approved' ||
      currentStatus === 'zonal-approved' ||
      currentStatus === 'expense-returned' ||
      currentStatus === 'admin-approved'
    ) {
      const isExpenseDeptUser = await this.isExpenseDepartmentUser(actorId);
      const isFinanceDeptUser = await this.isFinanceDepartmentUser(actorId);

      if (!isFinalApproverAdminRole && !isExpenseDeptUser) {
        if (isFinanceDeptUser) {
          // Recorded for compliance: Finance lost approve/reject/return rights.
          logger.warn(
            `Blocked expense action '${action}' on ${expense._id} by Finance user ${actorId}: Finance can no longer approve, reject or return expenses.`
          );
          throw new ApiError(
            httpStatus.FORBIDDEN,
            'Finance can no longer approve, reject or return expenses — the Expense department is the final approver.'
          );
        }
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'Only Expense department or Admin can action this expense.'
        );
      }

      if (action === 'returned') {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Returning an expense is no longer supported — the Expense department is the final approver.'
        );
      }

      if (action === 'approved') {
        expense.status = 'expense-approved';
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
        // One stage for every action here now — Finance no longer returns
        // expenses, so the old `expense-resubmit` stage is history-only.
        stage: 'expense-final-approval',
      });
      return expense.save();
    }

    throw new ApiError(
      httpStatus.CONFLICT,
      `Expense in '${expense.status}' state cannot be modified.`
    );
  }

  /** Finance department, or Admin/Sub Admin oversight. */
  async canRaiseFinanceIssue(currentUser) {
    const role = (currentUser.role || '').toLowerCase();
    if (this.superAdminRoles.includes(role)) return true;
    return this.isFinanceDepartmentUser(currentUser.id);
  }

  /**
   * Finance "Raise an Issue". Finance cannot approve/reject/return (the
   * Expense department is the final approver), so raising an issue only
   * records the note on the claim and in its approval history — `status`
   * is never touched.
   */
  async raiseFinanceIssue({ expenseId, message, currentUser }) {
    if (!(await this.canRaiseFinanceIssue(currentUser))) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Only the Finance department or Admin can raise an issue on an expense.'
      );
    }
    const expense = await Expense.findById(expenseId);
    if (!expense || expense.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found.');
    }
    if (expense.isDraft) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This expense is still a draft. Issues can only be raised on submitted claims.'
      );
    }

    const actorId = String(currentUser.id || currentUser._id || '');
    expense.financeIssues.push({ raisedBy: actorId, message });
    expense.hasFinanceIssue = true;
    this.pushApprovalHistory(expense, {
      action: 'issue-raised',
      byUserId: actorId,
      remark: message,
      stage: 'finance-issue',
    });
    return expense.save();
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

  buildExpenseDashboardDateRange(month, year, fromDate, toDate) {
    if (fromDate && toDate) {
      const startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
      return { startDate, endDate };
    }
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
        // Rejected at any stage — TL or Expense department.
        mapped.push(...this.expenseRejectedStatuses());
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
      filters.year,
      filters.fromDate,
      filters.toDate
    );

    const match = {
      isDeleted: { $ne: true },
      isDraft: { $ne: true },
      date: { $gte: startDate, $lte: endDate },
    };

    const role = user.role;
    const isSuperAdminRole = this.superAdminRoles.includes(role);
    const access = await this.resolveExpenseDashboardAccess(user);

    const teamKey = this.resolveDashboardTeamKey(
      (filters.team || user.team || '').trim() || user.team
    );

    if (access.scope === 'team') {
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

    // Single-employee filter (dashboard drill-down) narrows the viewer's role
    // scope above — it never widens it. An employee outside that scope
    // simply yields no rows, exactly as the grouped view would show.
    if (filters.employeeId) {
      const targetUserId = await this.resolveDashboardEmployeeUserId(filters.employeeId);
      const scoped = match.userId;
      const isInScope = scoped?.$in
        ? scoped.$in.some((id) => String(id) === String(targetUserId))
        : scoped
          ? String(scoped) === String(targetUserId)
          : true; // 'team' scope — `match.team` still restricts the rows.
      match.userId = isInScope ? targetUserId : { $in: [] };
    }

    // Department filter — Expense rows carry no department, so it resolves to
    // that department's users and intersects with whatever user scope the
    // viewer's role (and any employee filter) already allows.
    if (filters.departmentId) {
      const deptUsers = await User.find({
        department: filters.departmentId,
        isDeleted: { $ne: true },
      })
        .select('_id')
        .lean();
      const deptUserIds = deptUsers.map((entry) => String(entry._id));

      const scoped = match.userId;
      let allowedIds = deptUserIds;

      if (scoped?.$in) {
        const scopedIds = scoped.$in.map(String);
        allowedIds = deptUserIds.filter((id) => scopedIds.includes(id));
      } else if (scoped) {
        allowedIds = deptUserIds.includes(String(scoped)) ? [String(scoped)] : [];
      }

      match.userId = { $in: allowedIds.map((id) => this.toObjectId(id)) };
    }

    const statuses = this.resolveDashboardStatusFilter(filters.status);
    if (statuses?.length) {
      match.status = { $in: statuses };
    }

    // Free-text search narrows the rows the viewer is already allowed to see:
    // the KAPP ID / name typed on the expense form, the institute, or the
    // employee's name / employee code.
    const search = (filters.search || '').trim();
    if (search) {
      const searchRegex = this.buildRegex(search);
      const matchingUsers = await User.find({
        isDeleted: { $ne: true },
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { employeeId: searchRegex },
          {
            $expr: {
              $regexMatch: {
                input: {
                  $concat: [
                    { $ifNull: ['$firstName', ''] },
                    ' ',
                    { $ifNull: ['$lastName', ''] },
                  ],
                },
                regex: searchRegex.source,
                options: 'i',
              },
            },
          },
        ],
      })
        .select('_id')
        .lean();

      match.$or = [
        { kappId: searchRegex },
        { name: searchRegex },
        { instituteName: searchRegex },
        { userId: { $in: matchingUsers.map((entry) => this.toObjectId(entry._id)) } },
      ];
    }

    return match;
  }

  /**
   * One employee's individual expense rows for the dashboard drill-down,
   * ordered by expense date. Reuses `buildExpenseDashboardMatch` so the same
   * month/year/status/department/permission scoping applies as the grouped view.
   */
  async getExpenseDashboardEmployeeRecords(user, filters) {
    if (!filters.employeeId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'employeeId is required.');
    }

    const match = await this.buildExpenseDashboardMatch(user, filters);

    const rows = await Expense.find(match)
      .select(
        'date name type subCategory miscellaneousType amount status purpose attachmentUrl'
      )
      .sort({ date: 1, createdAt: 1 })
      .limit(500)
      .lean();

    return rows;
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

  /**
   * Flat, unaggregated expense lines for the "custom grouping" dashboard view
   * — each filed expense line (one category, one date, one account) is its
   * own row. Grouping into the two dropdown-selected levels happens on the
   * frontend so any combination of fields can be nested either way.
   */
  buildExpenseLineItemsPipeline(match, limit = 2000) {
    const cappedLimit = Math.min(Math.max(1, Number(limit) || 2000), 5000);

    return [
      { $match: match },
      { $sort: { date: 1, createdAt: 1 } },
      { $limit: cappedLimit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'employee',
        },
      },
      { $unwind: { path: '$employee', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          date: 1,
          employeeId: '$userId',
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
          expenseBand: '$employee.expenseBand',
          kappId: { $ifNull: ['$kappId', ''] },
          instituteName: { $ifNull: ['$instituteName', ''] },
          type: 1,
          subCategory: 1,
          miscellaneousType: 1,
          cityTier: 1,
          tripContext: 1,
          attendeeUserIds: 1,
          amount: 1,
          status: 1,
          policyTag: 1,
          policyBreaches: 1,
        },
      },
    ];
  }

  /**
   * The policy cap that applies to a filed line, for display. Uses the
   * breach's recorded cap when the line was flagged out-of-policy; otherwise
   * recomputes the applicable cap from the same constants `assertPhase2Policy`
   * checks against, so in-policy lines still show a cap to compare against.
   */
  resolveExpenseLineDisplayCap(expense, band) {
    if (Array.isArray(expense.policyBreaches) && expense.policyBreaches.length) {
      return expense.policyBreaches[0].capAmount ?? null;
    }

    const type = expense.type;
    const sub = String(expense.subCategory || '').trim();

    if (type === 'Food' && (sub === 'Metro' || sub === 'Non-Metro')) {
      const tier = sub === 'Metro' ? 'metro' : 'nonMetro';
      return FOOD_DAILY_CAP[band]?.[tier] ?? null;
    }

    if (type === 'Miscellaneous' && sub === 'Hotel Accommodation') {
      const tierKey = expense.cityTier === 'Metro' ? 'metro' : 'nonMetro';
      return HOTEL_PER_NIGHT_CAP[band]?.[tierKey] ?? null;
    }

    if (type === 'Mobile Bill') {
      return MOBILE_BILL_FIXED_AMOUNT;
    }

    if (type === 'Travel' && expense.tripContext === TRIP_CONTEXTS.BASE_LOCATION) {
      return BASE_LOCATION_TRAVEL_PER_MEETING_CAP[band] ?? null;
    }

    if (type === 'Team Lunch') {
      const count = Array.isArray(expense.attendeeUserIds)
        ? expense.attendeeUserIds.length
        : 0;
      return count ? this.roundMoney(count * TEAM_LUNCH_PER_ATTENDEE) : null;
    }

    return null;
  }

  formatExpenseLineItemRow(row) {
    const band = this.resolveExpenseBand(row.expenseBand);
    const subCategory = String(row.subCategory || row.miscellaneousType || '').trim();

    return {
      id: row._id,
      date: row.date,
      employeeId: row.employeeId,
      employeeName: row.employeeName || '',
      kappId: row.kappId || '',
      instituteName: row.instituteName || '',
      account: row.instituteName
        ? `${row.instituteName}${row.kappId ? ` (${row.kappId})` : ''}`
        : row.kappId || '',
      category: row.type || '',
      subCategory,
      amount: this.formatExpenseDashboardMoney(row.amount),
      cap: this.resolveExpenseLineDisplayCap(row, band),
      status: row.status,
      policyTag:
        row.policyTag === EXPENSE_POLICY_TAGS.OUT_OF_POLICY
          ? EXPENSE_POLICY_TAGS.OUT_OF_POLICY
          : EXPENSE_POLICY_TAGS.IN_POLICY,
    };
  }

  async getExpenseDashboard(user, filters, page = 1, limit = 10) {
    const groupBy = filters.groupBy || 'employee';
    const isDepartmentView = groupBy === 'department';
    const isCustomView = groupBy === 'custom';
    const access = await this.resolveExpenseDashboardAccess(user);
    const match = await this.buildExpenseDashboardMatch(user, filters);

    if (isCustomView) {
      const pipeline = this.buildExpenseLineItemsPipeline(match, filters.limit || limit);
      const rows = await Expense.aggregate(pipeline);
      const data = rows.map((row) => this.formatExpenseLineItemRow(row));
      const totalAppliedExpense = data.reduce(
        (sum, entry) => sum + Number(entry.amount || 0),
        0
      );

      return {
        summary: {
          totalRecords: data.length,
          totalAppliedExpense: this.formatExpenseDashboardMoney(totalAppliedExpense),
        },
        data,
        pagination: {
          totalDocs: data.length,
          limit: data.length,
          totalPages: data.length ? 1 : 0,
          currentPage: 1,
          pagingCounter: data.length ? 1 : 0,
          hasPrevPage: false,
          hasNextPage: false,
          prevPage: null,
          nextPage: null,
        },
        filters: {
          fromDate: filters.fromDate || null,
          toDate: filters.toDate || null,
          month: filters.month ? Number(filters.month) : null,
          year: filters.year ? Number(filters.year) : null,
          team: filters.team || null,
          employeeId: filters.employeeId || null,
          status: filters.status || null,
          groupBy,
          groupField1: filters.groupField1 || 'date',
          groupField2: filters.groupField2 || 'account',
        },
        access,
      };
    }

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
    return this.buildPersonalExpenseDashboard(user.id);
  }

  /**
   * Same aggregates as `getMyExpenseDashboard`, for a Team Lead / Sub Team
   * Lead viewing one of their own reportees from View Team (or Admin/HR
   * viewing anyone). Authorization happens here, not on the caller.
   */
  async getTeamMemberExpenseDashboard(currentUser, targetUserId) {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user id.');
    }

    const targetUser = await User.findOne({
      _id: targetUserId,
      isDeleted: { $ne: true },
    })
      .select('teamLeadId subTeamLeadId')
      .lean();
    if (!targetUser) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const role = (currentUser.role || '').toLowerCase();
    const actorId = String(currentUser.id || currentUser._id || '');
    const isAdminRole = this.adminRoles.includes(role);
    const isTlRole = this.tlRoles.includes(role);
    const isDirectLead =
      String(targetUser.teamLeadId || '') === actorId ||
      String(targetUser.subTeamLeadId || '') === actorId;

    if (!isAdminRole && !(isTlRole && isDirectLead)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'You can only view the expense dashboard for your own team members.'
      );
    }

    return this.buildPersonalExpenseDashboard(targetUserId);
  }

  /**
   * The authenticated user's own spend for one calendar month, metered
   * against the monthly budget. Drives the running total on the Add Expense
   * form, so it is deliberately cheap: one aggregate, own rows only.
   *
   * Statuses default to "not rejected" (still in flight, or fully approved) —
   * a rejected claim is not spend. `type` and `status` narrow the slice so
   * the claimant can see how the total breaks down.
   */
  async getMyMonthlyExpenseTotal(user, filters = {}) {
    if (!user?.id) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Could not identify user.');
    }

    const now = new Date();
    const year = Number(filters.year) || now.getFullYear();
    const month = Number(filters.month) || now.getMonth() + 1;

    // An explicit range (the list's date-range filter) wins over month/year.
    const hasRange = Boolean(filters.fromDate || filters.toDate);
    let rangeStart;
    let rangeEnd;
    if (hasRange) {
      rangeStart = filters.fromDate
        ? new Date(filters.fromDate)
        : new Date(year, month - 1, 1);
      rangeEnd = filters.toDate ? new Date(filters.toDate) : new Date(rangeStart);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      rangeEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const match = {
      userId: this.toObjectId(user.id),
      isDeleted: { $ne: true },
      isDraft: { $ne: true },
      date: { $gte: rangeStart, $lte: rangeEnd },
    };

    const types = this.splitCsvFilter(filters.type);
    if (types.length) {
      match.type = { $in: types };
    }

    const statuses = this.splitCsvFilter(filters.status);
    match.status = {
      $in: statuses.length
        ? statuses
        : [...this.expensePendingStatuses(), 'expense-approved'],
    };

    const [result] = await Expense.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: '$amount' },
                expenseCount: { $sum: 1 },
              },
            },
          ],
          byType: [
            {
              $group: {
                _id: '$type',
                amount: { $sum: '$amount' },
                count: { $sum: 1 },
              },
            },
            { $sort: { amount: -1 } },
          ],
        },
      },
    ]);

    const totalAmount = this.roundMoney(result?.totals?.[0]?.totalAmount || 0);

    return {
      month,
      year,
      fromDate: rangeStart,
      toDate: rangeEnd,
      isCustomRange: hasRange,
      totalAmount,
      budgetAmount: MONTHLY_EXPENSE_BUDGET,
      remainingAmount: this.roundMoney(
        Math.max(0, MONTHLY_EXPENSE_BUDGET - totalAmount)
      ),
      isOverBudget: totalAmount > MONTHLY_EXPENSE_BUDGET,
      expenseCount: result?.totals?.[0]?.expenseCount || 0,
      byType: (result?.byType || []).map((entry) => ({
        type: entry._id,
        amount: this.roundMoney(entry.amount),
        count: entry.count,
      })),
    };
  }

  /** Shared aggregation behind getMyExpenseDashboard / getTeamMemberExpenseDashboard. */
  async buildPersonalExpenseDashboard(targetUserId) {
    const userId = this.toObjectId(targetUserId);
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
      isDraft: { $ne: true },
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
      isDraft: { $ne: true },
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

  /**
   * Multi-expense-for-one-meeting flow — every draft line the current user
   * has saved but not yet submitted, newest first. Grouping by date + KAPP ID
   * happens on the client (each group is small and this keeps the endpoint
   * a plain list, easy to page later if needed).
   */
  async listExpenseDrafts(user) {
    const rows = await Expense.find({
      userId: this.toObjectId(user.id),
      isDraft: true,
      isDeleted: { $ne: true },
    })
      .sort({ date: -1, createdAt: 1 })
      .lean();

    return rows.map((row) => ({ ...row, isDraft: true }));
  }

  /**
   * Multi-expense-for-one-meeting flow — the claimant hits "Submit" once for
   * the whole date + KAPP ID group. Every matching draft line already carries
   * its final routing (status/tlId/policy tag) from the moment it was saved,
   * so submitting just lifts the `isDraft` flag; nothing is re-validated.
   * Returns the now-submitted docs so the caller can send the deferred
   * notification emails exactly as a normal create would have.
   */
  async submitExpenseDrafts(user, { date, kappId, instituteName }) {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);

    const query = {
      userId: this.toObjectId(user.id),
      isDraft: true,
      isDeleted: { $ne: true },
      date: day,
      kappId: String(kappId || '').trim(),
    };
    if (instituteName) {
      query.instituteName = String(instituteName).trim();
    }

    const drafts = await Expense.find(query);
    if (!drafts.length) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'No draft expenses found for this date and KAPP ID.'
      );
    }

    for (const draft of drafts) {
      draft.isDraft = false;
      this.pushApprovalHistory(draft, {
        action: 'submitted',
        byUserId: user.id,
        stage: 'employee',
      });
      await draft.save();
    }

    return Expense.find({ _id: { $in: drafts.map((d) => d._id) } }).populate([
      {
        path: 'userId',
        select:
          'firstName lastName employeeId email role teamLeadId subTeamLeadId expenseBand',
      },
      { path: 'tlId', select: 'firstName lastName employeeId email role' },
      { path: 'attendeeUserIds', select: 'firstName lastName employeeId email' },
    ]);
  }
}

module.exports = new ExpenseService();
