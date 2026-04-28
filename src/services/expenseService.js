const { default: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../utility/ApiError');
const Expense = require('../models/expenseModel');
const User = require('../models/userModel');

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

    const userWithLeads = await User.findById(user.id).select(
      'teamLeadId subTeamLeadId team'
    );
    if (!userWithLeads) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    const hasTeamLead = Boolean(
      userWithLeads.teamLeadId || userWithLeads.subTeamLeadId
    );
    const status = hasTeamLead ? 'submitted' : 'tl-approved';

    const expense = await Expense.create({
      userId: user.id,
      team: userWithLeads.team || user.team,
      date: expenseDate,
      name: payload.name,
      type: payload.type,
      miscellaneousType:
        payload.type === 'Miscellaneous' ? payload.miscellaneousType || undefined : undefined,
      amount: Number(payload.amount),
      purpose: payload.purpose,
      attachmentUrl: payload.attachmentUrl || undefined,
      status,
      tlId: hasTeamLead ? undefined : user.id,
      tlRemark: hasTeamLead
        ? undefined
        : 'Auto-routed to finance because team lead is not mapped.',
    });

    return Expense.findById(expense._id).populate([
      {
        path: 'userId',
        select: 'firstName lastName employeeId email role teamLeadId subTeamLeadId',
      },
      { path: 'tlId', select: 'firstName lastName employeeId email role' },
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
    let priorityStatuses = [];

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
      priorityStatuses = ['submitted'];
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
      priorityStatuses = ['tl-approved'];
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

    let data = [];
    const totalDocs = await Expense.countDocuments(query);

    if (priorityStatuses.length > 0) {
      const pipeline = [
        { $match: query },
        {
          $addFields: {
            __actionPriority: {
              $cond: [{ $in: ['$status', priorityStatuses] }, 0, 1],
            },
          },
        },
        { $sort: { __actionPriority: 1, createdAt: -1 } },
        { $skip: skip },
        { $limit: perPage },
      ];
      data = await Expense.aggregate(pipeline);
      data = await Expense.populate(data, populateOptions);
    } else {
      data = await Expense.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .populate(populateOptions);
    }

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
