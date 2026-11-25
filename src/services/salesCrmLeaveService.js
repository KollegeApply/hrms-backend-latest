// src/services/salesCrmLeaveService.js
//
// Who in the Sales department is on approved leave on a day, for the Kapp Sales CRM (its DRS & Compliance report shows
// "on leave" instead of 0 meetings for them). Read only: nothing in HRMS is changed.
const moment = require('moment-timezone');
const LeaveApplication = require('../models/leaveApplicationModel');
const User = require('../models/userModel');
const Department = require('../models/departmentModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

const TZ = 'Asia/Kolkata';
const TEAM_CODE = 'KAP';

/**
 * @param {string} date YYYY-MM-DD (IST day)
 * @param {{ includeHalfDay?: boolean }} [opts] half-day leave is left out by default (the person still works half the day)
 * @returns {Promise<Array<{ email: string|null, employee_id: string|null, name: string, status: 'approved', is_half_day: boolean, half_day_type: string|null }>>}
 */
async function leavesOnDay(date, opts = {}) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !moment.tz(date, 'YYYY-MM-DD', true, TZ).isValid()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'date must be YYYY-MM-DD');
  }
  const start = moment.tz(date, 'YYYY-MM-DD', TZ).startOf('day').toDate();
  const end = moment.tz(date, 'YYYY-MM-DD', TZ).endOf('day').toDate();

  const salesDept = await Department.findOne({ name: { $regex: '^sales$', $options: 'i' }, isDeleted: false }).select('_id').lean();
  if (!salesDept) return [];
  const users = await User.find({ department: salesDept._id, isDeleted: false, employeeId: { $regex: new RegExp(`^${TEAM_CODE}_`, 'i') } })
    .select('_id firstName lastName email employeeId')
    .lean();
  if (!users.length) return [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const query = {
    userId: { $in: users.map((u) => u._id) },
    status: 'approved',
    isDeleted: { $ne: true },
    dates: { $elemMatch: { $gte: start, $lte: end } },
  };
  if (!opts.includeHalfDay) query.isHalfDay = { $ne: true };
  const leaves = await LeaveApplication.find(query).select('userId isHalfDay halfDayType').lean();

  const seen = new Set();
  const out = [];
  for (const l of leaves) {
    const u = byId.get(String(l.userId));
    if (!u || seen.has(String(u._id))) continue;
    seen.add(String(u._id));
    out.push({
      email: u.email ? String(u.email).toLowerCase() : null,
      employee_id: u.employeeId || null,
      name: [u.firstName, u.lastName].filter(Boolean).join(' '),
      status: 'approved',
      is_half_day: !!l.isHalfDay,
      half_day_type: l.halfDayType || null,
    });
  }
  return out;
}

module.exports = { leavesOnDay };
