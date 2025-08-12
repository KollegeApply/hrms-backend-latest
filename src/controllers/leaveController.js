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
const moment = require("moment-timezone");

const getAllLeave = catchAsync(async (req, res) => {
  const currentUser = req.user;
  let leaves;

  if (
    currentUser.role === 'admin' ||
    currentUser.role === 'subadmin' ||
    currentUser.role === 'hr'
  ) {
    leaves = await leaveService?.getAllLeave(currentUser.team);
  } else if (
    currentUser.role === 'teamlead' ||
    currentUser.role === 'subteamlead'
  ) {
    leaves = await leaveService?.getLeaveTl({ id: currentUser.id, team:currentUser.team });
  } else {
    leaves = await leaveService?.getLeaveById({ id: currentUser.id });
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave retrieved successfully.',
    data: leaves,
  });
});

// Get leave by Id
const getLeaveById = catchAsync(async (req, res) => {
  const validatedData = await leaveValidator?.leaveIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const user1 = req?.user;
  let leaveFound;
  if (user1?.role === 'teamlead' || user1?.role === 'subteamlead') {
    leaveFound = await leaveService?.getLeaveTl(validatedData);
  } else leaveFound = await leaveService?.getLeaveById(validatedData);
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
  const leaveId = req?.params?.id;
  const status = req?.body?.status;
  const edittorId = req?.user?.id;
  const user = req?.user;
  const team = user?.team;

  const currentLeave = await LeaveApplication.findById(leaveId).populate('userId');
  if (!currentLeave) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
  }

  let targetStatus = status;


  if (status === 'approved') {
    if (['teamlead', 'subteamlead'].includes(user.role)) {
      if (currentLeave.status === 'tl-pending') {
        targetStatus = 'hr-pending';
      } else {
        throw new ApiError(httpStatus.FORBIDDEN, 'Team leads can only approve TL-pending leaves.');
      }
    } else if (['admin', 'hr', 'subadmin'].includes(user.role)) {
      if (currentLeave.status === 'hr-pending') {
        targetStatus = 'approved';
      } else {
        throw new ApiError(httpStatus.CONFLICT, 'HR can only approve HR-pending leaves.');
      }
    } else {
      throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to approve leaves.');
    }

  } else if (status === 'rejected') {
    if (['teamlead', 'subteamlead'].includes(user.role)) {
      if (currentLeave.status === 'tl-pending') {
        targetStatus = 'tl-rejected';
      } else {
        throw new ApiError(httpStatus.FORBIDDEN, 'Team leads can only reject TL-pending leaves.');
      }
    } else if (['admin', 'hr', 'subadmin'].includes(user.role)) {
      if (currentLeave.status === 'hr-pending') {
        targetStatus = 'hr-rejected';
      } else {
        throw new ApiError(httpStatus.CONFLICT, 'HR can only reject HR-pending leaves.');
      }
    } else {
      throw new ApiError(httpStatus.FORBIDDEN, 'You do not have permission to reject leaves.');
    }

  } else if (status === 'auto-rejected') {
    targetStatus = 'auto-rejected';

  } else if (status === 'revoked') {
    if (['tl-pending', 'hr-pending'].includes(currentLeave.status)) {
      targetStatus = 'revoked';
    } else {
      throw new ApiError(httpStatus.CONFLICT, 'You can only revoke pending leaves.');
    }
  }

  const validatedData = await leaveValidator?.updateLeaveSchema?.validateAsync({
    leaveId,
    status: targetStatus,
    edittorId,
    userId: user?.id,
  });
  const updatedData = await leaveService?.updateLeave(validatedData);
  if (!updatedData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found or update failed.');
  }

  const leaveType = await leaveTypeModel.findById(updatedData?.leaveTypeId).select('name');

  if (updatedData.status) {
    const mailReciever = await User.findById(updatedData.userId)
      .populate('teamLeadId', 'email')
      .populate('subTeamLeadId', 'email');

    if (mailReciever?.email) {
      const leaveDates = updatedData.dates;
      if (!leaveDates || (Array.isArray(leaveDates) && leaveDates.length === 0)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or missing leave date');
      }

      let formattedLeaveDates = '';
      if (Array.isArray(leaveDates)) {
        const fromMoment = moment(leaveDates[0]).tz('Asia/Kolkata');
        const toMoment = moment(leaveDates[leaveDates.length - 1]).tz('Asia/Kolkata');
        formattedLeaveDates = fromMoment.isSame(toMoment, 'day')
          ? fromMoment.format('DD MMMM YYYY')
          : `${fromMoment.format('DD MMMM YYYY')} to ${toMoment.format('DD MMMM YYYY')}`;
      } else {
        formattedLeaveDates = moment(leaveDates).tz('Asia/Kolkata').format('DD MMMM YYYY');
      }

      const configEmails = getTeamEmailConfig(team);
      let emailSubject, emailMessage, receiverEmails = [], ccEmails = [];

      switch (updatedData.status) {
        case 'hr-pending':
          emailSubject = 'Leave Request Pending Your Approval';
          emailMessage = Helper.leaveHRPendingNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team,
            process.env.HRMS_FRONTEND_URL
          );
          receiverEmails = [configEmails.HR_EMAIL];
          ccEmails = [mailReciever?.email];
          if (mailReciever?.teamLeadId?.email) ccEmails.push(mailReciever.teamLeadId.email);
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
          break;

        case 'tl-rejected':
          emailSubject = 'Your Leave Request Has Been Rejected by Team Lead';
          emailMessage = Helper.leaveTLRejectionNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team
          );
          receiverEmails = [mailReciever?.email];
          ccEmails = [configEmails.HR_EMAIL];
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
          break;

        case 'hr-rejected':
          emailSubject = 'Your Leave Request Has Been Rejected by HR';
          emailMessage = Helper.leaveHRRejectionNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team
          );
          receiverEmails = [mailReciever?.email];
          if (mailReciever?.teamLeadId?.email) ccEmails.push(mailReciever.teamLeadId.email);
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
          break;

        case 'approved':
          emailSubject = 'Your Leave Request Has Been Approved';
          emailMessage = Helper.leaveHRApprovalNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team
          );
          receiverEmails = [mailReciever?.email];
          ccEmails = [...configEmails.ADMIN_EMAILS];
          if (mailReciever?.teamLeadId?.email) ccEmails.push(mailReciever.teamLeadId.email);
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
          break;

        case 'auto-rejected':
          emailSubject = 'Your Leave Request Has Been Automatically Rejected';
          emailMessage = Helper.leaveAutoRejectionNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team
          );
          receiverEmails = [mailReciever?.email];
          ccEmails = [configEmails.HR_EMAIL];
          if (mailReciever?.teamLeadId?.email) ccEmails.push(mailReciever.teamLeadId.email);
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
          ccEmails.push(...configEmails.ADMIN_EMAILS);
          break;

        case 'revoked':
          emailSubject = 'Leave Request Revoked by Employee';
          emailMessage = Helper.leaveRevokedNotification(
            mailReciever?.firstName,
            formattedLeaveDates,
            leaveType?.name,
            updatedData?.leaveReason,
            team
          );
          receiverEmails = [configEmails.HR_EMAIL];
          if (currentLeave.status === 'tl-pending' && mailReciever?.teamLeadId?.email) {
            receiverEmails = [mailReciever.teamLeadId.email];
          }
          ccEmails = [...configEmails.ADMIN_EMAILS];
          if (mailReciever?.subTeamLeadId?.email) ccEmails.push(mailReciever.subTeamLeadId.email);
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
    }
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Leave updated successfully.',
    data: updatedData,
  });
});


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
    .populate('subTeamLeadId', 'email');

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

    // Send email
    Helper.sendEmail({
      receiverEmails: [
        configEmails?.HR_EMAIL
      ],
      subject: 'Revoked leave application',
      message: Helper.WfhLeaveRevoked(
        user?.firstName,
        'Leave',
        formattedLeaveDates,
        leaveType,
        null,
        teamCode,
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
      .populate('subTeamLeadId', 'firstName email firstName');

    const hasTL = user?.teamLeadId || user?.subTeamLeadId;

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

    const configEmails = getTeamEmailConfig(team);

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
              userName: user?.firstName,
              tlName: user?.teamLeadId?.firstName || user?.subTeamLeadId?.firstName,
              requestType: 'Leave',
              leaveType: leaveType?.name || 'Leave',
              fromDate: from,
              toDate: to,
              reason: leaveReason,
              dashboardUrl: process?.env?.HRMS_FRONTEND_URL,
              team,
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
