const httpStatus = require('http-status-codes');
const leaveService = require('../services/leaveService');
const leaveValidator = require('../validators/leaveValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const { getTeamEmailConfig } = require('../utility/constants');
const User = require('../models/userModel');
const { formatDateToKolkata } = require('../utility/common');
const LeaveApplication = require('../models/leaveApplicationModel');
const leaveTypeModel = require('../models/leaveTypeModel');
const EmployeeLeaveBalance = require('../models/employeeLeaveBalanceModel');
const moment = require("moment-timezone");

const getAllLeave = catchAsync(async (req, res) => {
  const currentUser = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const { status, department, search } = req.query;
  let leaves;

  // Check if user is Finance department teamlead
  let isFinanceTeamlead = false;
  if (currentUser.role === 'teamlead') {
    const userWithDept = await User.findById(currentUser.id).populate('department', 'name').lean();
    isFinanceTeamlead = userWithDept?.department?.name?.toLowerCase()?.trim() === 'finance';
  }

  if (
    currentUser.role === 'admin' ||
    currentUser.role === 'subadmin' ||
    currentUser.role === 'hr' ||
    isFinanceTeamlead
  ) {
    // Pass financeTeamLeadId if user is Finance TL to prioritize their team members
    const financeTeamLeadId = isFinanceTeamlead ? currentUser.id : null;
    leaves = await leaveService?.getAllLeave(
      currentUser.team,
      page,
      limit,
      financeTeamLeadId,
      { status, department, search },
      currentUser.id,
      currentUser.role
    );
  } else if (
    currentUser.role === 'teamlead' ||
    currentUser.role === 'subteamlead'
  ) {
    leaves = await leaveService?.getLeaveTl(
      { id: currentUser.id, team: currentUser.team },
      page,
      limit,
      { status, department, search }
    );
  } else {
    leaves = await leaveService?.getLeaveById({ id: currentUser.id }, page, limit);
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave retrieved successfully.',
    data: leaves.data,
    pagination: leaves.pagination,
  });
});

const getLeaveById = catchAsync(async (req, res) => {
  const validatedData = await leaveValidator?.leaveIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  
  // Always get leaves by specific user ID, regardless of role
  // This endpoint is for getting a specific user's leaves (e.g., for personal calendar)
  const leaveFound = await leaveService?.getLeaveById(validatedData);
  
  if (!leaveFound) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave retrieved successfully.',
    data: leaveFound,
  });
});


const updateLeave = catchAsync(async (req, res) => {
  const { id: leaveId } = req.params;
  const { status: action } = req.body; 
  const editor = req.user;
  const team = req.user.team;

  const updatedData = await leaveService.updateLeaveStatus({
    leaveId,
    action,
    editor,
  });

  await sendLeaveStatusUpdateEmail(updatedData, team);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Leave status updated successfully.',
    data: updatedData,
  });
});



async function sendLeaveStatusUpdateEmail(updatedLeave, team) {
  const mailReceiver = await User.findById(updatedLeave.userId)
    .populate('teamLeadId', 'email firstName')
    .populate('subTeamLeadId', 'email firstName')
    .populate('department', 'name');

  const leaveType = await leaveTypeModel.findById(updatedLeave.leaveTypeId).select('name');

  if (!mailReceiver || !leaveType) {
    logger.error(`Could not find user or leave type for leave ID: ${updatedLeave._id}`);
    return;
  }
  
  const fromMoment = moment(updatedLeave.dates[0]).tz('Asia/Kolkata');
  const toMoment = moment(updatedLeave.dates[updatedLeave.dates.length - 1]).tz('Asia/Kolkata');
  const formattedLeaveDates = fromMoment.isSame(toMoment, 'day')
      ? fromMoment.format('DD MMMM YYYY')
      : `${fromMoment.format('DD MMMM YYYY')} to ${toMoment.format('DD MMMM YYYY')}`;

  const configEmails = getTeamEmailConfig(team);
  let emailSubject = '', emailMessage = '', receiverEmails = [], ccEmails = [];

  // Prepare employee information for email templates
  const employeeInfo = {
    employeeId: mailReceiver.employeeId || 'N/A',
    jobTitle: mailReceiver.jobTitle || 'N/A',
    department: mailReceiver.department?.name || 'N/A'
  };

  switch (updatedLeave.status) {
    case 'hr-pending':
      emailSubject = 'Leave Request Pending Your Approval';
      emailMessage = Helper.leaveHRPendingNotification(mailReceiver.firstName, formattedLeaveDates, leaveType.name, updatedLeave.leaveReason, team, process.env.HRMS_FRONTEND_URL, updatedLeave.isHalfDay, updatedLeave.halfDayType, employeeInfo);
      receiverEmails = [configEmails.HR_EMAIL];
      ccEmails = [mailReceiver.email, mailReceiver.teamLeadId?.email, mailReceiver.subTeamLeadId?.email].filter(Boolean);
      break;
    case 'approved':
      emailSubject = 'Your Leave Request Has Been Approved';
      emailMessage = Helper.leaveHRApprovalNotification(mailReceiver.firstName, formattedLeaveDates, leaveType.name, updatedLeave.leaveReason, team, updatedLeave.isHalfDay, updatedLeave.halfDayType, employeeInfo);
      receiverEmails = [mailReceiver.email];
      ccEmails = [...configEmails.ADMIN_EMAILS, mailReceiver.teamLeadId?.email, mailReceiver.subTeamLeadId?.email].filter(Boolean);
      break;
    case 'tl-rejected':
      emailSubject = 'Your Leave Request Has Been Rejected by Team Lead';
      emailMessage = Helper.leaveTLRejectionNotification(mailReceiver.firstName, formattedLeaveDates, leaveType.name, updatedLeave.leaveReason, team, updatedLeave.isHalfDay, updatedLeave.halfDayType, employeeInfo);
      receiverEmails = [mailReceiver.email];
      ccEmails = [configEmails.HR_EMAIL, mailReceiver.teamLeadId?.email, mailReceiver.subTeamLeadId?.email].filter(Boolean);
      break;
    case 'hr-rejected':
      emailSubject = 'Your Leave Request Has Been Rejected by HR';
      emailMessage = Helper.leaveHRRejectionNotification(mailReceiver.firstName, formattedLeaveDates, leaveType.name, updatedLeave.leaveReason, team, updatedLeave.isHalfDay, updatedLeave.halfDayType, employeeInfo);
      receiverEmails = [mailReceiver.email];
      ccEmails = [configEmails.HR_EMAIL, mailReceiver.teamLeadId?.email, mailReceiver.subTeamLeadId?.email].filter(Boolean);
      break;
    case 'revoked':
      emailSubject = 'Leave Request Revoked by Employee';
      emailMessage = Helper.WfhLeaveRevoked(mailReceiver.firstName, 'Leave', formattedLeaveDates, leaveType.name, updatedLeave.leaveReason, team, employeeInfo);
      receiverEmails = [configEmails.HR_EMAIL, mailReceiver.teamLeadId?.email].filter(Boolean);
      ccEmails = [...configEmails.ADMIN_EMAILS, mailReceiver.subTeamLeadId?.email].filter(Boolean);
      break;
  }

      if (receiverEmails.length) {
        Helper.sendEmail({
          receiverEmails,
          subject: emailSubject,
          message: emailMessage,
          cc: ccEmails,
          team,
        }).catch(err => logger.error(`Failed to send leave notification:`, err));
      }
  
  

  // email sending handled above; nothing to return here
};


// delete leave
const deleteLeave = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const teamCode = req?.user?.team;
  const validatedData = await leaveValidator?.leaveIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const leave = await leaveService?.deleteLeave({
    id: validatedData.id,
    userId: userId,
  });
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
  }

  const user = await User?.findById(req?.user?.id)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email')
    .populate('department', 'name');

  const sendMail = req?.query?.sendMail === 'true';
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending revoke email to ${user?.teamLeadId?.email}`);

    let formattedLeaveDates = '';
    const leaveDates = leave?.dates;
    const leaveTypeData = await leaveTypeModel
      .findById(leave?.leaveTypeId)
      .select('name');
    const leaveType = leaveTypeData?.name;

    if (!leaveDates || (Array.isArray(leaveDates) && leaveDates.length === 0)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid or missing leave date'
      );
    }

    if (Array.isArray(leaveDates)) {
      const fromMoment = moment(leaveDates[0]).tz('Asia/Kolkata');
      const toMoment = moment(leaveDates[leaveDates.length - 1]).tz('Asia/Kolkata');
      
      if (fromMoment.isSame(toMoment, 'day')) {
        formattedLeaveDates = fromMoment.format('DD MMMM YYYY');
      } else {
        formattedLeaveDates = `${fromMoment.format('DD MMMM YYYY')} to ${toMoment.format('DD MMMM YYYY')}`;
      }
    } else {
      formattedLeaveDates = moment(leaveDates).tz('Asia/Kolkata').format('DD MMMM YYYY');
    }

    const configEmails = getTeamEmailConfig(teamCode);

    const ccEmails = [...configEmails?.ADMIN_EMAILS];
    if (user?.teamLeadId?.email) {
      ccEmails.push(user.teamLeadId.email);
    }
    if (user?.subTeamLeadId?.email) {
      ccEmails.push(user.subTeamLeadId.email);
    }

    // Prepare employee information for email templates
    const employeeInfo = {
      employeeId: user.employeeId || 'N/A',
      jobTitle: user.jobTitle || 'N/A',
      department: user.department?.name || 'N/A'
    };

    // Send email
    const userFullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    Helper.sendEmail({
      receiverEmails: [
        configEmails?.HR_EMAIL,
        ...configEmails?.ADMIN_EMAILS
      ],
      subject: 'Revoked leave application',
      message: Helper.WfhLeaveRevoked(
        userFullName,
        'Leave',
        formattedLeaveDates,
        leaveType,
        null,
        teamCode,
        employeeInfo,
      ),
      cc: ccEmails,
      team:teamCode,
    }).catch((err) =>
      logger.error(
        `Failed to send revoke email to ${user?.teamLeadId?.email} and others:`,
        err
      )
    );
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave deleted successfully.',
    data: leave,
  });
});

const applyForLeave = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const leaveData = req.body;
    const team = req.user.team;

    const user = await User.findById(userId)
      .populate('teamLeadId', 'firstName email firstName')
      .populate('subTeamLeadId', 'firstName email firstName')
      .populate('department', 'name');

    const hasTL = user?.teamLeadId || user?.subTeamLeadId;

  const userFullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  const primaryTlName = user?.teamLeadId
    ? `${user.teamLeadId.firstName || ''} ${user.teamLeadId.lastName || ''}`.trim()
    : (user?.subTeamLeadId
      ? `${user.subTeamLeadId.firstName || ''} ${user.subTeamLeadId.lastName || ''}`.trim()
      : '');

    leaveData.status = hasTL ? 'tl-pending' : 'hr-pending';

    const result = await leaveService.applyForLeave(userId, leaveData);

    if (!result.status) {
      return res.status(400).json({
        success: false,
        message: result.message,
        rejectedReasons: result.rejectedReasons || [],
      });
    }

    const leaveType = await leaveTypeModel
      .findById(result?.data?.leaveTypeId)
      .select('name');

    const from = result?.data?.dates[0];
    const to = result?.data?.dates[result?.data?.dates?.length - 1];
    const leaveReason = result?.data?.leaveReason;
    const isHalfDay = result?.data?.isHalfDay;
    const halfDayType = result?.data?.halfDayType;

    const configEmails = getTeamEmailConfig(team);

    // Get leave balance
    const leaveBalance = await EmployeeLeaveBalance.findOne({
      userId,
      leaveTypeId: result?.data?.leaveTypeId
    });

    const totalAvailable = leaveBalance ? (leaveBalance.total - leaveBalance.used) : 0;

    // Prepare employee information for email templates
    const employeeInfo = {
      employeeId: user.employeeId || 'N/A',
      jobTitle: user.jobTitle || 'N/A',
      department: user.department?.name || 'N/A',
      leaveBalance: totalAvailable
    };

    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Sending leave application email`);

      if (hasTL) {
        const primaryRecipient = user?.teamLeadId?.email || user?.subTeamLeadId?.email;

        const ccList = [configEmails.HR_EMAIL, ...configEmails.ADMIN_EMAILS];
        if (user?.subTeamLeadId?.email && user?.subTeamLeadId?.email !== primaryRecipient) {
          ccList.push(user.subTeamLeadId.email);
        }

        if (primaryRecipient) {
          Helper.sendEmail({
            receiverEmails: [primaryRecipient],
            subject: 'Leave Application - Action Required',
            message: Helper.WfhLeaveApplication({
              userName: userFullName,
              tlName: primaryTlName,
              requestType: 'Leave',
              leaveType: leaveType?.name || 'Leave',
              fromDate: from,
              toDate: to,
              reason: leaveReason,
              dashboardUrl: process?.env?.HRMS_FRONTEND_URL,
              team,
              isHalfDay: isHalfDay,
              halfDayType: halfDayType,
              employeeInfo: employeeInfo,
            }),
            cc: ccList,
            team,
          }).catch((err) =>
            logger.error(`Failed to send leave application email to TL:`, err)
          );
        }
      } else {
        const ccList = [...configEmails.ADMIN_EMAILS];
        if (user?.subTeamLeadId?.email) {
          ccList.push(user.subTeamLeadId.email);
        }

        Helper.sendEmail({
          receiverEmails: [configEmails.HR_EMAIL],
          subject: 'Leave Application - Action Required',
          message: Helper.WfhLeaveApplication({
            userName: user?.firstName,
            tlName: user?.teamLeadId?.firstName || user?.subTeamLeadId?.firstName,
            requestType: 'Leave',
            leaveType: leaveType?.name || 'Leave',
            fromDate: from,
            toDate: to,
            reason: leaveReason,
            dashboardUrl: process?.env?.HRMS_FRONTEND_URL,
            team,
            isHalfDay: isHalfDay,
            halfDayType: halfDayType,
            employeeInfo: employeeInfo,
          }),
          cc: ccList,
          team,
        }).catch((err) =>
          logger.error(`Failed to send leave application email to HR:`, err)
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    console.error('Error in applyForLeave controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error applying for leave',
    });
  }
});


const getLeaveApplications = catchAsync(async (req, res) => {
  const { employeeId } = req.query;
  let query = { isDeleted: false };
  if (employeeId) query.employeeId = employeeId;
  const applications = await LeaveApplication.find(query).sort({
    appliedOn: -1,
  });
  res.status(200).json({ status: true, data: applications });
});

module.exports = {
  getAllLeave,
  getLeaveById,
  updateLeave,
  //   updateDepartment,
  deleteLeave,
  applyForLeave,
  getLeaveApplications,
};
