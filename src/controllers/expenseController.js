const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const expenseService = require('../services/expenseService');
const expenseValidator = require('../validators/expenseValidator');
const logger = require('../config/logger');
const { uploadToAWS } = require('../utility/awsBlob');
const { transformDocumentPaths, formatDateToKolkata } = require('../utility/common');
const Helper = require('../utility/helper');
const User = require('../models/userModel');
const Expense = require('../models/expenseModel');
const { getTeamEmailConfig } = require('../utility/constants');

function parseMaybeJsonArray(val) {
  if (val == null || val === '') return undefined;
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p.map(String).filter(Boolean) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pickDefined(obj) {
  const o = {};
  if (!obj) return o;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') o[k] = v;
  }
  return o;
}

function parseCreateExpenseBody(req) {
  const { expenseData } = req.body;

  let parsed = null;
  if (typeof expenseData === 'string') {
    try {
      parsed = JSON.parse(expenseData);
    } catch {
      return null;
    }
  } else if (expenseData && typeof expenseData === 'object' && !Array.isArray(expenseData)) {
    parsed = { ...expenseData };
  }

  const flat = pickDefined({
    date: req.body.date,
    name: req.body.name,
    type: req.body.type,
    amount:
      req.body.amount != null && req.body.amount !== ''
        ? Number(req.body.amount)
        : undefined,
    purpose: req.body.purpose,
    attachmentUrl: req.body.attachmentUrl,
    miscellaneousType: req.body.miscellaneousType ?? req.body.otherType ?? req.body.customType,
    subCategory: req.body.subCategory,
    distanceKm:
      req.body.distanceKm !== '' && req.body.distanceKm != null
        ? Number(req.body.distanceKm)
        : undefined,
    clientName: req.body.clientName,
    clientPocName: req.body.clientPocName,
    clientPocDesignation: req.body.clientPocDesignation,
    attendeeUserIds: parseMaybeJsonArray(req.body.attendeeUserIds),
    miscOthersDescription: req.body.miscOthersDescription,
    travelMiscDescription: req.body.travelMiscDescription,
    cityTier: req.body.cityTier,
  });

  const merged = parsed ? { ...parsed, ...flat } : flat;
  if (merged.attendeeUserIds != null) {
    merged.attendeeUserIds =
      parseMaybeJsonArray(merged.attendeeUserIds) ?? merged.attendeeUserIds;
  }
  if (merged.distanceKm != null && typeof merged.distanceKm === 'string') {
    merged.distanceKm = Number(merged.distanceKm);
  }
  if (merged.amount != null && typeof merged.amount === 'string') {
    merged.amount = Number(merged.amount);
  }

  if (parsed) return merged;
  if (Object.keys(flat).length === 0) return null;
  return merged;
}

function getUploadedFile(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  return null;
}

function applyAttachmentUrlTransform(expense) {
  if (!expense) return expense;
  const plain = typeof expense.toObject === 'function' ? expense.toObject() : { ...expense };
  if (plain.attachmentUrl) {
    const t = transformDocumentPaths({ attachmentUrl: plain.attachmentUrl });
    plain.attachmentUrl = t.attachmentUrl;
  }
  if (plain.type === 'Miscellaneous' && plain.subCategory) {
    plain.displayExpenseLabel = `${plain.type} — ${plain.subCategory}`;
  }
  return plain;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getExpenseLink(expenseId) {
  if (!process.env.HRMS_FRONTEND_URL) return '#';
  const baseUrl = String(process.env.HRMS_FRONTEND_URL).replace(/\/+$/, '');
  return `${baseUrl}/expense`;
}

function currencyInr(amount) {
  return `₹${Number(amount || 0).toFixed(2)}`;
}

function fullName(user = {}) {
  return `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
}

const expensePopulatePaths = [
  {
    path: 'userId',
    select: 'firstName lastName email employeeId',
  },
  {
    path: 'tlId',
    select: 'firstName lastName email employeeId',
  },
  {
    path: 'approvalHistory.byUserId',
    select: 'firstName lastName email employeeId',
  },
];

/** Expense Department approver emails: team-scoped, plus admins and the team's fallback inbox. */
async function getExpenseApproverEmails(team) {
  const approvers = await User.find({
    team,
    isDeleted: { $ne: true },
  })
    .populate('department', 'name')
    .select('email role department')
    .lean();

  const fromUsers = approvers
    .filter((entry) => {
      const role = (entry.role || '').toLowerCase();
      const departmentName = (entry.department?.name || '').toLowerCase().trim();
      return role === 'admin' || departmentName === 'expense';
    })
    .map((entry) => entry.email)
    .filter(Boolean);

  let fallback = [];
  try {
    const config = getTeamEmailConfig(team);
    fallback = [config.FINANCE_EMAIL].filter(Boolean);
  } catch (error) {
    logger.warn(`Expense email fallback config unavailable for team ${team}: ${error.message}`);
  }
  return [...new Set([...fromUsers, ...fallback])];
}

/** Finance Department approver emails: NOT team-scoped — Finance reviews expenses across all teams. */
async function getFinanceApproverEmails() {
  const approvers = await User.find({
    isDeleted: { $ne: true },
  })
    .populate('department', 'name')
    .select('email role department')
    .lean();

  const fromUsers = approvers
    .filter((entry) => {
      const departmentName = (entry.department?.name || '').toLowerCase().trim();
      return departmentName === 'finance';
    })
    .map((entry) => entry.email)
    .filter(Boolean);

  return [...new Set(fromUsers)];
}

function getMailPayload(expenseDoc) {
  const employee = expenseDoc?.userId || {};
  const resolvedExpenseType = (() => {
    const t = expenseDoc?.type;
    const sc = expenseDoc?.subCategory;
    if (t === 'Miscellaneous' && sc) return `Miscellaneous (${sc})`;
    if (sc && (t === 'Travel' || t === 'Food')) return `${t} (${sc})`;
    return t || 'N/A';
  })();
  return {
    employeeName: fullName(employee),
    employeeEmail: employee.email,
    employeeId: employee.employeeId || 'N/A',
    expenseType: resolvedExpenseType,
    amount: currencyInr(expenseDoc?.amount),
    expenseDate: expenseDoc?.date ? formatDateToKolkata(expenseDoc.date) : 'N/A',
    purpose: expenseDoc?.purpose || '',
    expenseLink: getExpenseLink(expenseDoc?._id),
  };
}

function renderExpenseButton(label, link, color = '#1d4ed8') {
  return `
    <div style="margin-top: 22px;">
      <a href="${escapeHtml(link || '#')}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600;font-size:14px;">
        ${escapeHtml(label)}
      </a>
    </div>
  `;
}

function renderExpenseDetailRow(label, value) {
  return `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px dashed #e5e7eb;">
      <div style="min-width:145px;color:#4b5563;font-size:14px;font-weight:700;">${escapeHtml(label)}</div>
      <div style="color:#111827;font-size:14px;line-height:1.5;word-break:break-word;">${escapeHtml(value || '-')}</div>
    </div>
  `;
}

function getTeamFooterLabel(team) {
  try {
    const config = getTeamEmailConfig(team);
    return `Team ${config?.TEAM_NAME || 'HRMS'}`;
  } catch (error) {
    logger.warn(`Unable to resolve team name for expense emails (${team}): ${error.message}`);
    return 'Team HRMS';
  }
}

function renderExpenseEmailTemplate({
  heading,
  greeting,
  intro,
  team,
  detailRowsHtml = '',
  remarks = '',
  remarksLabel = 'Remarks',
  outro = '',
  ctaLabel,
  ctaLink,
  ctaColor = '#1d4ed8',
  footerLabel,
}) {
  const resolvedFooterLabel = footerLabel || getTeamFooterLabel(team);
  const remarksBlock = remarks
    ? `
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 14px;margin-top:16px;color:#7c2d12;font-size:14px;line-height:1.5;">
        <strong>${escapeHtml(remarksLabel)}:</strong><br/>${escapeHtml(remarks)}
      </div>
    `
    : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:20px auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;">
      <div style="background:#ffffff;border-radius:8px;padding:26px;box-shadow:0 2px 5px rgba(0,0,0,0.06);">
        <h2 style="margin:0 0 14px;color:#0f172a;font-size:22px;">${escapeHtml(heading)}</h2>
        <p style="margin:0 0 10px;color:#1f2937;font-size:15px;">Hi ${escapeHtml(greeting)},</p>
        <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>

        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-left:4px solid #1d4ed8;border-radius:6px;padding:12px 14px;margin:16px 0;">
          ${detailRowsHtml}
        </div>

        ${remarksBlock}
        ${outro ? `<p style="margin:14px 0 0;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(outro)}</p>` : ''}
        ${ctaLabel ? renderExpenseButton(ctaLabel, ctaLink, ctaColor) : ''}
        <p style="margin:22px 0 0;color:#6b7280;font-size:13px;">Regards,<br/><strong>${escapeHtml(resolvedFooterLabel)}</strong></p>
      </div>
    </div>
  `;
}

async function sendExpenseSubmissionEmails(expenseDoc, team) {
  try {
    const payload = getMailPayload(expenseDoc);
    const employeeUser = await User.findById(expenseDoc.userId?._id || expenseDoc.userId)
      .populate('teamLeadId', 'email firstName lastName')
      .populate('subTeamLeadId', 'email firstName lastName')
      .lean();

    if (!employeeUser) return;

    const tlEmail = employeeUser.teamLeadId?.email || employeeUser.subTeamLeadId?.email;
    const tlName = employeeUser.teamLeadId
      ? fullName(employeeUser.teamLeadId)
      : employeeUser.subTeamLeadId
        ? fullName(employeeUser.subTeamLeadId)
        : 'Team';

    if (tlEmail && expenseDoc.status === 'submitted') {
      const tlMessage = renderExpenseEmailTemplate({
        heading: 'New Expense Claim Pending Review',
        greeting: tlName,
        intro: 'A new expense claim has been submitted and requires your review.',
        team,
        detailRowsHtml:
          renderExpenseDetailRow('Employee', `${payload.employeeName} (${payload.employeeId})`) +
          renderExpenseDetailRow('Expense Type', payload.expenseType) +
          renderExpenseDetailRow('Amount', payload.amount) +
          renderExpenseDetailRow('Date', payload.expenseDate),
        ctaLabel: 'Review Now',
        ctaLink: payload.expenseLink,
      });

      Helper.sendEmail({
        receiverEmails: [tlEmail],
        subject: 'New Expense Claim Pending Your Review',
        message: tlMessage,
        team,
      }).catch((err) => logger.error('Failed to send expense submit mail to TL:', err));
    }

    if (payload.employeeEmail) {
      const employeeMessage = renderExpenseEmailTemplate({
        heading: 'Expense Submitted Successfully',
        greeting: payload.employeeName,
        intro:
          expenseDoc.status === 'submitted'
            ? 'Your expense claim has been submitted and is pending review by your Team Lead.'
            : expenseDoc.type === 'Team Lunch'
              ? 'Your Team Lunch claim has been submitted and is pending Expense approval (TL review is skipped for this type).'
              : 'Your expense claim has been submitted and is pending final approval.',
        team,
        detailRowsHtml:
          renderExpenseDetailRow('Expense Type', payload.expenseType) +
          renderExpenseDetailRow('Amount', payload.amount) +
          renderExpenseDetailRow('Date', payload.expenseDate),
        ctaLabel: 'Track Status',
        ctaLink: payload.expenseLink,
      });

      Helper.sendEmail({
        receiverEmails: [payload.employeeEmail],
        subject: 'Expense Submitted Successfully',
        message: employeeMessage,
        team,
      }).catch((err) =>
        logger.error('Failed to send expense submission confirmation mail:', err)
      );
    }

    // Direct-to-Expense-Department: no TL mapped, or Team Lunch (Expense-Department-only per policy).
    if (expenseDoc.status === 'tl-approved' && (!tlEmail || expenseDoc.type === 'Team Lunch')) {
      const finalApproverEmails = await getExpenseApproverEmails(team);
      if (finalApproverEmails.length > 0) {
        const finalQueueMsg = renderExpenseEmailTemplate({
          heading: 'Expense Awaiting Final Approval',
          greeting: 'Team',
          intro:
            expenseDoc.type === 'Team Lunch'
              ? 'A Team Lunch expense was submitted by a Team Lead and requires Expense approval.'
              : 'An expense claim has reached the final review stage and requires your action.',
          team,
          detailRowsHtml:
            renderExpenseDetailRow(
              'Employee',
              `${payload.employeeName} (${payload.employeeId})`
            ) +
            renderExpenseDetailRow('Expense Type', payload.expenseType) +
            renderExpenseDetailRow('Amount', payload.amount),
          ctaLabel: 'Review & Approve',
          ctaLink: payload.expenseLink,
        });

        Helper.sendEmail({
          receiverEmails: finalApproverEmails,
          subject:
            expenseDoc.type === 'Team Lunch'
              ? 'Team Lunch — Awaiting Expense Approval'
              : 'Expense Awaiting Final Approval',
          message: finalQueueMsg,
          team,
        }).catch((err) =>
          logger.error('Failed to notify final approvers for direct final queue expense:', err)
        );
      }
    }
  } catch (error) {
    logger.error('Failed while preparing expense submission emails:', error);
  }
}

async function sendExpenseStatusUpdateEmail({
  previousStatus,
  updatedExpense,
  action,
  currentUser,
  team,
}) {
  try {
    const payload = getMailPayload(updatedExpense);
    const newStatus = updatedExpense.status;

    if (previousStatus === 'submitted') {
      if (action === 'approved') {
        const finalApproverEmails = await getExpenseApproverEmails(team);
        if (finalApproverEmails.length > 0) {
          const msg = renderExpenseEmailTemplate({
            heading: 'TL Approved Expense - Awaiting Final Approval',
            greeting: 'Team',
            intro:
              'A Team Lead has approved this expense claim. Final approver action is now required.',
            team,
            detailRowsHtml:
              renderExpenseDetailRow(
                'Employee',
                `${payload.employeeName} (${payload.employeeId})`
              ) +
              renderExpenseDetailRow('Approved By (TL)', fullName(currentUser)) +
              renderExpenseDetailRow('Expense Type', payload.expenseType) +
              renderExpenseDetailRow('Amount', payload.amount),
            ctaLabel: 'Review & Approve',
            ctaLink: payload.expenseLink,
          });
          Helper.sendEmail({
            receiverEmails: finalApproverEmails,
            subject: 'Expense Approved by TL – Awaiting Final Approval',
            message: msg,
            team,
          }).catch((err) =>
            logger.error('Failed to send TL approved mail to final approvers:', err)
          );
        }
      } else if (action === 'rejected' && payload.employeeEmail) {
        const msg = renderExpenseEmailTemplate({
          heading: 'Your Expense Claim Was Rejected by Team Lead',
          greeting: payload.employeeName,
          intro:
            'Your expense claim has been reviewed and unfortunately rejected by your Team Lead.',
          team,
          detailRowsHtml:
            renderExpenseDetailRow('Type', payload.expenseType) +
            renderExpenseDetailRow('Date', payload.expenseDate) +
            renderExpenseDetailRow('Amount', payload.amount),
          remarks: updatedExpense.tlRemark || '-',
          remarksLabel: 'Reason for Rejection',
          outro: 'You may review the feedback and resubmit after corrections.',
          ctaLabel: 'View Expense',
          ctaLink: payload.expenseLink,
          ctaColor: '#dc2626',
        });
        Helper.sendEmail({
          receiverEmails: [payload.employeeEmail],
          subject: 'Your Expense Claim Has Been Rejected',
          message: msg,
          team,
        }).catch((err) =>
          logger.error('Failed to send TL rejection mail to employee:', err)
        );
      }
      return;
    }

    if (
      (previousStatus === 'tl-approved' || previousStatus === 'expense-returned') &&
      newStatus === 'admin-approved'
    ) {
      const financeApproverEmails = await getFinanceApproverEmails();
      if (financeApproverEmails.length > 0) {
        const isResubmission = previousStatus === 'expense-returned';
        const msg = renderExpenseEmailTemplate({
          heading: isResubmission
            ? 'Expense Resubmitted for Finance Review'
            : 'Expense Awaiting Finance Review',
          greeting: 'Finance Department',
          intro: isResubmission
            ? 'The Expense Department has resubmitted a previously returned expense for your review.'
            : 'An expense claim has been reviewed by the Expense Department and now requires Finance review.',
          team,
          detailRowsHtml:
            renderExpenseDetailRow(
              'Employee',
              `${payload.employeeName} (${payload.employeeId})`
            ) +
            renderExpenseDetailRow('Expense Type', payload.expenseType) +
            renderExpenseDetailRow('Amount', payload.amount),
          remarks: updatedExpense.expenseRemark || '',
          remarksLabel: 'Expense Department Remark',
          ctaLabel: 'Review Now',
          ctaLink: payload.expenseLink,
          footerLabel: `${getTeamFooterLabel(team)} - Expense Department`,
        });
        Helper.sendEmail({
          receiverEmails: financeApproverEmails,
          subject: isResubmission
            ? 'Expense Resubmitted for Finance Review'
            : 'Expense Awaiting Finance Review',
          message: msg,
          team,
        }).catch((err) =>
          logger.error('Failed to notify Finance Department of expense review:', err)
        );
      }
      return;
    }

    if (
      (previousStatus === 'tl-approved' || previousStatus === 'expense-returned') &&
      newStatus === 'expense-rejected' &&
      payload.employeeEmail
    ) {
      const msg = renderExpenseEmailTemplate({
        heading: 'Your Expense Claim Was Not Approved',
        greeting: payload.employeeName,
        intro:
          'Your expense claim was reviewed by the final approver and was not approved.',
        team,
        detailRowsHtml:
          renderExpenseDetailRow('Type', payload.expenseType) +
          renderExpenseDetailRow('Amount', payload.amount),
        remarks: updatedExpense.expenseRemark || '-',
        ctaLabel: 'View Details',
        ctaLink: payload.expenseLink,
        ctaColor: '#dc2626',
        footerLabel: `${getTeamFooterLabel(team)} - Expense Department`,
      });
      Helper.sendEmail({
        receiverEmails: [payload.employeeEmail],
        subject: 'Your Expense Claim Was Not Approved',
        message: msg,
        team,
      }).catch((err) =>
        logger.error('Failed to send final rejection mail to employee:', err)
      );
      return;
    }

    if (
      previousStatus === 'admin-approved' &&
      newStatus === 'expense-approved' &&
      payload.employeeEmail
    ) {
      const msg = renderExpenseEmailTemplate({
        heading: 'Your Expense Claim Has Been Approved',
        greeting: payload.employeeName,
        intro: 'Good news — your expense claim has been fully approved.',
        team,
        detailRowsHtml:
          renderExpenseDetailRow('Amount Approved', payload.amount) +
          renderExpenseDetailRow('Expense Type', payload.expenseType),
        outro: 'The reimbursement will be processed as per the finance cycle.',
        ctaLabel: 'View Details',
        ctaLink: payload.expenseLink,
        ctaColor: '#15803d',
        footerLabel: `${getTeamFooterLabel(team)} - Expense Department`,
      });
      Helper.sendEmail({
        receiverEmails: [payload.employeeEmail],
        subject: 'Your Expense Claim Has Been Approved',
        message: msg,
        team,
      }).catch((err) =>
        logger.error('Failed to send final approval mail to employee:', err)
      );
      return;
    }

    if (
      previousStatus === 'admin-approved' &&
      newStatus === 'expense-returned'
    ) {
      const expenseApproverEmails = await getExpenseApproverEmails(team);
      if (expenseApproverEmails.length > 0) {
        const msg = renderExpenseEmailTemplate({
          heading: 'Expense Returned by Finance',
          greeting: 'Expense Department',
          intro:
            'Finance has returned an expense claim for further review or correction.',
          team,
          detailRowsHtml:
            renderExpenseDetailRow(
              'Employee',
              `${payload.employeeName} (${payload.employeeId})`
            ) +
            renderExpenseDetailRow('Expense Type', payload.expenseType) +
            renderExpenseDetailRow('Amount', payload.amount),
          remarks: updatedExpense.financeRemark || '',
          remarksLabel: 'Finance Remark',
          ctaLabel: 'Review Now',
          ctaLink: payload.expenseLink,
          ctaColor: '#dc2626',
          footerLabel: `${getTeamFooterLabel(team)} - Finance Department`,
        });
        Helper.sendEmail({
          receiverEmails: expenseApproverEmails,
          subject: 'Expense Returned by Finance — Action Required',
          message: msg,
          team,
        }).catch((err) =>
          logger.error('Failed to notify Expense Department of Finance return:', err)
        );
      }
    }
  } catch (error) {
    logger.error('Failed while preparing expense status update emails:', error);
  }
}

const createExpense = catchAsync(async (req, res) => {
  const raw = parseCreateExpenseBody(req);
  if (raw == null) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Invalid payload for expenseData',
    });
  }

  let uploadedPath = null;
  const uploadedFile = getUploadedFile(req);
  if (uploadedFile) {
    try {
      uploadedPath = await uploadToAWS(
        uploadedFile.buffer,
        uploadedFile.originalname,
        'hrms-expenses/'
      );
      logger.info(`Expense receipt uploaded: ${uploadedPath}`);
    } catch (error) {
      logger.error('Failed to upload expense receipt:', error);
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        status: false,
        message: 'Failed to upload receipt. Please try again.',
      });
    }
  }

  const attachmentUrl = uploadedPath || raw.attachmentUrl || undefined;

  const payload = await expenseValidator.createExpenseSchema.validateAsync({
    ...raw,
    miscellaneousType: raw.miscellaneousType ?? raw.otherType ?? raw.customType,
    attachmentUrl,
  });

  const expense = await expenseService.createExpense(req.user, payload);
  const data = applyAttachmentUrlTransform(expense);

  const sendMail = !(req?.body?.sendMail === false || req?.body?.sendMail === 'false');
  if (sendMail) {
    await sendExpenseSubmissionEmails(expense, req.user.team);
  }

  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Expense submitted successfully.',
    data,
  });
});

const getExpenses = catchAsync(async (req, res) => {
  const validatedQuery = await expenseValidator.listExpenseSchema.validateAsync(
    req.query
  );

  const expenses = await expenseService.getExpenses(
    req.user,
    validatedQuery,
    validatedQuery.page,
    validatedQuery.limit
  );

  const data = expenses.data.map((doc) => applyAttachmentUrlTransform(doc));

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Expense list fetched successfully.',
    data,
    pagination: expenses.pagination,
  });
});

const getExpenseDashboard = catchAsync(async (req, res) => {
  const validatedQuery = await expenseValidator.expenseDashboardSchema.validateAsync(
    req.query
  );

  const dashboard = await expenseService.getExpenseDashboard(
    req.user,
    validatedQuery,
    validatedQuery.page,
    validatedQuery.limit
  );

  res.status(httpStatus.OK).json({
    status: true,
    message:
      validatedQuery.groupBy === 'department'
        ? 'Department expense dashboard fetched successfully.'
        : 'Expense dashboard fetched successfully.',
    summary: dashboard.summary,
    data: dashboard.data,
    pagination: dashboard.pagination,
    filters: dashboard.filters,
    access: dashboard.access,
  });
});

const getMyExpenseDashboard = catchAsync(async (req, res) => {
  const dashboard = await expenseService.getMyExpenseDashboard(req.user);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Personal expense dashboard fetched successfully.',
    data: dashboard,
  });
});

const getTlBulkSummary = catchAsync(async (req, res) => {
  const validatedQuery = await expenseValidator.tlBulkSummarySchema.validateAsync(
    req.query
  );

  const result = await expenseService.getTlBulkSummary(req.user, validatedQuery);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Bulk approve summary fetched successfully.',
    data: result.data,
  });
});

const updateExpenseStatus = catchAsync(async (req, res) => {
  const validated = await expenseValidator.updateExpenseStatusSchema.validateAsync({
    id: req.params.id,
    action: req.body.action,
    remark: req.body.remark,
    expectedStatus: req.body.expectedStatus,
  });

  const existingExpense = await Expense.findById(validated.id).select('status');
  const previousStatus = existingExpense?.status;

  const updated = await expenseService.updateExpenseStatus({
    expenseId: validated.id,
    action: validated.action,
    remark: validated.remark,
    expectedStatus: validated.expectedStatus,
    currentUser: req.user,
  });

  const updatedExpense = await Expense.findById(updated._id)
    .populate(expensePopulatePaths)
    .lean();

  const sendMail = !(req?.body?.sendMail === false || req?.body?.sendMail === 'false');
  if (sendMail && previousStatus) {
    await sendExpenseStatusUpdateEmail({
      previousStatus,
      updatedExpense,
      action: validated.action,
      currentUser: req.user,
      team: req.user.team,
    });
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Expense status updated successfully.',
    data: applyAttachmentUrlTransform(updatedExpense || updated),
  });
});

const bulkRejectExpenses = catchAsync(async (req, res) => {
  const validated = await expenseValidator.bulkRejectExpenseSchema.validateAsync(
    req.body
  );

  const { rejected, failed } = await expenseService.bulkRejectExpenses({
    expenseIds: validated.expenseIds,
    remark: validated.remark,
    currentUser: req.user,
  });

  const sendMail = !(
    req?.body?.sendMail === false || req?.body?.sendMail === 'false'
  );

  const rejectedExpenses = [];
  for (const item of rejected) {
    const updatedExpense = await Expense.findById(item.updated._id)
      .populate(expensePopulatePaths)
      .lean();

    if (sendMail && item.previousStatus) {
      await sendExpenseStatusUpdateEmail({
        previousStatus: item.previousStatus,
        updatedExpense,
        action: 'rejected',
        currentUser: req.user,
        team: req.user.team,
      });
    }

    rejectedExpenses.push(applyAttachmentUrlTransform(updatedExpense || item.updated));
  }

  const summary = {
    total: validated.expenseIds.length,
    succeeded: rejectedExpenses.length,
    failed: failed.length,
  };

  if (rejectedExpenses.length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'No expenses could be rejected.',
      data: { rejected: [], failed },
      summary,
    });
  }

  const message =
    failed.length === 0
      ? `${rejectedExpenses.length} expense(s) rejected successfully.`
      : `${rejectedExpenses.length} expense(s) rejected successfully. ${failed.length} failed.`;

  res.status(httpStatus.OK).json({
    status: true,
    message,
    data: {
      rejected: rejectedExpenses,
      failed,
    },
    summary,
  });
});

const bulkApproveExpenses = catchAsync(async (req, res) => {
  const validated = await expenseValidator.bulkApproveExpenseSchema.validateAsync(
    req.body
  );

  const { approved, failed } = await expenseService.bulkApproveExpenses({
    expenseIds: validated.expenseIds,
    remark: validated.remark,
    currentUser: req.user,
  });

  const sendMail = !(
    req?.body?.sendMail === false || req?.body?.sendMail === 'false'
  );

  const approvedExpenses = [];
  for (const item of approved) {
    const updatedExpense = await Expense.findById(item.updated._id)
      .populate(expensePopulatePaths)
      .lean();

    if (sendMail && item.previousStatus) {
      await sendExpenseStatusUpdateEmail({
        previousStatus: item.previousStatus,
        updatedExpense,
        action: 'approved',
        currentUser: req.user,
        team: req.user.team,
      });
    }

    approvedExpenses.push(applyAttachmentUrlTransform(updatedExpense || item.updated));
  }

  const summary = {
    total: validated.expenseIds.length,
    succeeded: approvedExpenses.length,
    failed: failed.length,
  };

  if (approvedExpenses.length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'No expenses could be approved.',
      data: { approved: [], failed },
      summary,
    });
  }

  const message =
    failed.length === 0
      ? `${approvedExpenses.length} expense(s) approved successfully.`
      : `${approvedExpenses.length} expense(s) approved successfully. ${failed.length} failed.`;

  res.status(httpStatus.OK).json({
    status: true,
    message,
    data: {
      approved: approvedExpenses,
      failed,
    },
    summary,
  });
});

const deleteExpense = catchAsync(async (req, res) => {
  const validated = await expenseValidator.expenseIdSchema.validateAsync({
    id: req.params.id,
  });

  const deleted = await expenseService.deleteExpense({
    expenseId: validated.id,
    currentUser: req.user,
  });

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Expense deleted successfully.',
    data: applyAttachmentUrlTransform(deleted),
  });
});

module.exports = {
  createExpense,
  getExpenses,
  getExpenseDashboard,
  getMyExpenseDashboard,
  getTlBulkSummary,
  updateExpenseStatus,
  bulkApproveExpenses,
  bulkRejectExpenses,
  deleteExpense,
};
