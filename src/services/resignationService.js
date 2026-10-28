const bcrypt = require('bcryptjs');
const { default: httpStatus } = require('http-status');
const User = require('../models/userModel');
const Resignation = require('../models/resignationModel');
const { RESIGNATION_STATUS } = Resignation;
const ApiError = require('../utility/ApiError');
const Helper = require('../utility/helper');
const logger = require('../config/logger');
const {
  getTeamEmailConfig,
  EMPLOYEE_STATUS,
} = require('../utility/constants');

const HR_ROLES = ['hr', 'admin', 'subadmin'];
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const ACTIVE_STATUSES = [
  RESIGNATION_STATUS.TL_PENDING,
  RESIGNATION_STATUS.TL_APPROVED,
  RESIGNATION_STATUS.RESIGNED,
];

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

// Store dates as noon UTC so timezone shifts never move the calendar day.
const toDay = (value) => {
  const d = new Date(value);
  if (isNaN(d)) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
};

const populateUser = [
  {
    path: 'userId',
    select: 'firstName lastName email employeeId hireDate team status jobTitle',
  },
  { path: 'tlActionBy', select: 'firstName lastName' },
  { path: 'hrActionBy', select: 'firstName lastName' },
];

// HR mailbox of the team (HR_EMAIL_SD / HR_EMAIL_KAP), same as the other modules.
const getToEmail = (team, fallbackTeam) => {
  let to;
  try {
    to = getTeamEmailConfig(team || fallbackTeam).HR_EMAIL;
  } catch (err) {
    logger.error(`Resignation HR email config error: ${err.message}`);
  }
  if (!to) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `No resignation mailbox configured for team ${team}.`
    );
  }
  return to;
};

// Admins CC'd on every resignation, for both SD and KAP: ADMIN_EMAILS_KAP.
const getAdminEmails = () => {
  try {
    return getTeamEmailConfig('KAP').ADMIN_EMAILS || [];
  } catch (err) {
    logger.error(`Resignation admin email config error: ${err.message}`);
    return [];
  }
};

const uniqueEmails = (list) => [
  ...new Set(list.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)),
];

const verifyPassword = async (userId, password) => {
  const user = await User.findById(userId).select('+password');
  if (!user || !password) return false;
  return bcrypt.compare(password, user.password);
};

const getApplyConfig = async (userId, team) => {
  const user = await User.findById(userId)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');

  const active = await Resignation.findOne({
    userId,
    status: { $in: ACTIVE_STATUSES },
  }).select('status');

  return {
    to: getToEmail(team, user.team),
    cc: uniqueEmails([
      user.teamLeadId?.email,
      user.subTeamLeadId?.email,
      ...getAdminEmails(),
    ]),
    hasActiveRequest: !!active,
    activeStatus: active?.status || null,
  };
};

// Active users of the same team, for the CC picker.
const getCcUsers = async (actor) => {
  const users = await User.find({
    team: actor.team,
    isDeleted: { $ne: true },
    _id: { $ne: actor.id },
    status: {
      $nin: [
        EMPLOYEE_STATUS.RESIGNED,
        EMPLOYEE_STATUS.TERMINATED,
        EMPLOYEE_STATUS.ABSCONDED,
      ],
    },
  })
    .select('firstName lastName email employeeId')
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    email: u.email,
    employeeId: u.employeeId || '',
  }));
};

const applyResignation = async (user, payload) => {
  const { emailSubject, emailBody, lastWorkingDay, extraCc = [] } = payload;

  const cfg = await getApplyConfig(user.id, user.team);
  if (cfg.hasActiveRequest) {
    throw new ApiError(httpStatus.CONFLICT, 'You already have an active resignation request.');
  }

  const extra = uniqueEmails(extraCc);
  const bad = extra.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new ApiError(httpStatus.BAD_REQUEST, `Invalid CC email: ${bad}`);
  if (extra.length) {
    const allowed = new Set((await getCcUsers(user)).map((u) => u.email.toLowerCase()));
    const outside = extra.find((e) => !allowed.has(e));
    if (outside) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${outside} is not a user of your team.`);
    }
  }

  const lwd = toDay(lastWorkingDay);
  if (!lwd) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid last working day.');
  if (lwd < toDay(new Date())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Last working day cannot be in the past.');
  }

  const cc = uniqueEmails([...cfg.cc, ...extra]).filter((e) => e !== cfg.to.toLowerCase());

  const resignation = await Resignation.create({
    userId: user.id,
    team: user.team,
    emailSubject: emailSubject.trim(),
    to: [cfg.to],
    cc,
    emailBody: emailBody.trim(),
    requestedLastWorkingDay: lwd,
    lastWorkingDay: lwd,
  });

  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
      <p style="white-space: pre-wrap;">${escapeHtml(emailBody.trim())}</p>
      <p><strong>My last working day will be ${formatDate(lwd)}</strong></p>
      <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;" />
      <p style="color:#666;font-size:12px;">
        Submitted via HRMS by ${escapeHtml(fullName)}${user.employeeId ? ` (${escapeHtml(user.employeeId)})` : ''} &lt;${escapeHtml(user.email)}&gt;
      </p>
    </div>`;

  try {
    const messageId = `<resignation-${resignation.id}@hrms>`;
    await Helper.sendEmail({
      receiverEmails: [cfg.to],
      cc,
      subject: emailSubject.trim(),
      message: html,
      team: user.team,
      messageId,
    });
    resignation.mailMessageId = messageId;
    resignation.emailSent = true;
    await resignation.save();
  } catch (err) {
    logger.error(`Resignation email failed for ${user.id}: ${err?.message}`);
  }

  return resignation;
};

// Replies on the original mail's thread: same subject (Re:), In-Reply-To/References.
const sendThreadReply = async (resignation, heading, detail) => {
  if (!resignation.mailMessageId) return;
  const employee = resignation.userId;
  const to = resignation.to;
  const toLower = to.map((t) => t.toLowerCase());
  const cc = uniqueEmails([...resignation.cc, employee?.email]).filter(
    (e) => !toLower.includes(e)
  );
  const subject = /^re:/i.test(resignation.emailSubject)
    ? resignation.emailSubject
    : `Re: ${resignation.emailSubject}`;
  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
      <p><strong>${escapeHtml(heading)}</strong></p>
      <p>${detail}</p>
      <p style="color:#666;font-size:12px;">Employee: ${escapeHtml(
        `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim()
      )}${employee?.employeeId ? ` (${escapeHtml(employee.employeeId)})` : ''}</p>
    </div>`;
  try {
    await Helper.sendEmail({
      receiverEmails: to,
      cc,
      subject,
      message: html,
      team: resignation.team,
      inReplyTo: resignation.mailMessageId,
      references: resignation.mailMessageId,
    });
  } catch (err) {
    logger.error(`Resignation thread mail failed for ${resignation.id}: ${err?.message}`);
  }
};

const actorName = (a) => `${a.firstName || ''} ${a.lastName || ''}`.trim();

const getMine =(userId) =>
  Resignation.find({ userId }).sort({ createdAt: -1 }).populate(populateUser);

// Employees whose requests this TL / sub-TL may action.
const getReporteeIds = async (actor) => {
  const conditions = [{ teamLeadId: actor.id }];
  if (actor.role === 'subteamlead' && actor.canApproveAsSubTeamLead) {
    conditions.push({ subTeamLeadId: actor.id });
  }
  const users = await User.find({ $or: conditions }).select('_id');
  return users.map((u) => u._id);
};

const getForTl = async (actor) => {
  const ids = await getReporteeIds(actor);
  return Resignation.find({ userId: { $in: ids } })
    .sort({ createdAt: -1 })
    .populate(populateUser);
};

// HR sees a request only once the TL has approved it (and its outcome after).
const getForHr = () =>
  Resignation.find({
    status: {
      $in: [
        RESIGNATION_STATUS.TL_APPROVED,
        RESIGNATION_STATUS.HR_REJECTED,
        RESIGNATION_STATUS.RESIGNED,
      ],
    },
  })
    .sort({ createdAt: -1 })
    .populate(populateUser);

const tlAction = async (actor, id, { action, lastWorkingDay }) => {
  const resignation = await Resignation.findById(id);
  if (!resignation) throw new ApiError(httpStatus.NOT_FOUND, 'Resignation not found.');
  if (resignation.status !== RESIGNATION_STATUS.TL_PENDING) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This request is not pending TL action.');
  }
  const reporteeIds = (await getReporteeIds(actor)).map(String);
  if (!reporteeIds.includes(String(resignation.userId))) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot action this request.');
  }

  if (action === 'approved') {
    const lwd = toDay(lastWorkingDay);
    if (!lwd) throw new ApiError(httpStatus.BAD_REQUEST, 'Select the last working day.');
    resignation.lastWorkingDay = lwd;
    resignation.status = RESIGNATION_STATUS.TL_APPROVED;
  } else if (action === 'rejected') {
    resignation.status = RESIGNATION_STATUS.TL_REJECTED;
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
  }
  resignation.tlActionBy = actor.id;
  resignation.tlActionAt = new Date();
  await resignation.save();
  await resignation.populate(populateUser);
  if (action === 'approved') {
    await sendThreadReply(
      resignation,
      'Resignation approved by Team Lead',
      `${escapeHtml(actorName(actor))} approved this resignation. Last working day: <strong>${formatDate(resignation.lastWorkingDay)}</strong>. It is now pending HR approval.`
    );
  } else {
    await sendThreadReply(
      resignation,
      'Resignation rejected by Team Lead',
      `${escapeHtml(actorName(actor))} rejected this resignation request.`
    );
  }
  return resignation;
};

const hrAction = async (actor, id, { action }) => {
  const resignation = await Resignation.findById(id);
  if (!resignation) throw new ApiError(httpStatus.NOT_FOUND, 'Resignation not found.');
  if (resignation.status !== RESIGNATION_STATUS.TL_APPROVED) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This request is not pending HR action.');
  }

  if (action === 'approved') {
    resignation.status = RESIGNATION_STATUS.RESIGNED;
    await User.findByIdAndUpdate(resignation.userId, {
      status: EMPLOYEE_STATUS.RESIGNED,
    });
  } else if (action === 'rejected') {
    resignation.status = RESIGNATION_STATUS.HR_REJECTED;
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action.');
  }
  resignation.hrActionBy = actor.id;
  resignation.hrActionAt = new Date();
  await resignation.save();
  await resignation.populate(populateUser);
  if (action === 'approved') {
    await sendThreadReply(
      resignation,
      'Resignation approved by HR',
      `${escapeHtml(actorName(actor))} approved this resignation. Status: <strong>Resigned</strong>. Last working day: <strong>${formatDate(resignation.lastWorkingDay)}</strong>.`
    );
  } else {
    await sendThreadReply(
      resignation,
      'Resignation rejected by HR',
      `${escapeHtml(actorName(actor))} rejected this resignation request.`
    );
  }
  return resignation;
};

module.exports = {
  HR_ROLES,
  verifyPassword,
  getApplyConfig,
  getCcUsers,
  applyResignation,
  getMine,
  getForTl,
  getForHr,
  tlAction,
  hrAction,
};
