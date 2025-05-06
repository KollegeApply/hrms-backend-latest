const httpStatus = require('http-status-codes');
const leaveService = require('../services/leaveService');
const leaveValidator = require('../validators/leaveValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const { HR_EMAIL, LEAVETYPES } = require('../utility/constants');
const User = require('../models/userModel');
const { formatDateToKolkata } = require('../utility/common');

const createLeave = catchAsync(async (req, res) => {
  const { from, to, leaveReason, leaveType } = req.body;
  const userId = req?.user?.id;

  const validatedData = await leaveValidator?.createLeaveSchema?.validateAsync({
    from: from,
    to: to,
    leaveReason: leaveReason,
    userId: userId,
    leaveType: leaveType,
  });

  const data = await leaveService?.createLeave(validatedData);

  const user = await User?.findById(req?.user?.id)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending leave email to ${user?.teamLeadId}`);
    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Leave Applied',
      message: Helper.WfhLeaveApplication({
        username: user?.firstName,
        requestType: 'leave',
        leaveType: LEAVETYPES[leaveType] || 'Monthly Leave',
        fromDate: new Date(from),
        toDate: new Date(to),
        reason: leaveReason,
      }),
    }).catch((err) =>
      logger.error(`Failed to send leave email to ${user?.teamLeadId}:`, err)
    );
  }

  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Leave created successfully!',
    data: data,
  });
});

// Get all leave
const getAllLeave = catchAsync(async (req, res) => {
  const leaves = await leaveService?.getAllLeave();

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Leave retrieved successfully.',
    data: leaves,
  });
});

// // Get leave by Id
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

// Update leave
const updateLeave = catchAsync(async (req, res) => {
  const leaveId = req?.params?.id;
  const status = req?.body?.status;
  const edittorId = req?.user?.id;
  const user = req?.user;
  const validatedData = await leaveValidator?.updateLeaveSchema?.validateAsync({
    leaveId,
    status,
    edittorId,
    userId: user?.id,
  });
  const updated = await leaveService?.updateLeave(validatedData);

  if (!updated) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Leave not found or update failed.'
    );
  }

  const mailReciever = await User.findById(updated?.userId);

  // Handle email sending for approved leave
  if (updated?.status === 'approved') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on leave request ${mailReciever?.email}`);

      // Determine leave message and date formatting
      const leaveDates = updated?.dates;

      if (
        !leaveDates ||
        (Array.isArray(leaveDates) && leaveDates.length === 0)
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid or missing leave date'
        );
      }

      let formattedLeaveDates = '';
      if (Array.isArray(leaveDates)) {
        const sortedDates = leaveDates
          .map((d) => new Date(d))
          .sort((a, b) => a - b);
        const from = formatDateToKolkata(sortedDates[0]);
        const to = formatDateToKolkata(sortedDates[sortedDates.length - 1]);
        formattedLeaveDates = from === to ? from : `${from} to ${to}`;
      } else {
        formattedLeaveDates = formatDateToKolkata(leaveDates);
      }

      // Send approval email
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Approved`,
        message: Helper.leaveWFHApproval(
          mailReciever?.firstName,
          'leave',
          formattedLeaveDates,
          LEAVETYPES[updated?.leaveType],
          updated?.leaveReason
        ),
      }).catch((err) =>
        logger.error(
          `Failed to send update on leave request email to ${mailReciever?.email}:`,
          err
        )
      );
    }
  }

  // Handle email sending for rejected leave
  if (updated?.status === 'rejected') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on leave request ${mailReciever?.email}`);

      // Determine leave message and date formatting
      const leaveDates = updated?.dates;

      if (
        !leaveDates ||
        (Array.isArray(leaveDates) && leaveDates.length === 0)
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid or missing leave date'
        );
      }

      let formattedLeaveDates = '';
      if (Array.isArray(leaveDates)) {
        const sortedDates = leaveDates
          .map((d) => new Date(d))
          .sort((a, b) => a - b);
        const from = formatDateToKolkata(sortedDates[0]);
        const to = formatDateToKolkata(sortedDates[sortedDates.length - 1]);
        formattedLeaveDates = from === to ? from : `${from} to ${to}`;
      } else {
        formattedLeaveDates = formatDateToKolkata(leaveDates);
      }

      // Send rejection email
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Declined`,
        message: Helper.leaveWFHReject(
          mailReciever?.firstName,
          'leave',
          formattedLeaveDates,
          LEAVETYPES[updated?.leaveType],
          updated?.leaveReason
        ),
      }).catch((err) =>
        logger.error(
          `Failed to send update on leave request email to ${mailReciever?.email}:`,
          err
        )
      );
    }
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Leave updated successfully.',
    data: updated,
  });
});

// delete leave
const deleteLeave = catchAsync(async (req, res) => {
  const validatedData = await leaveValidator?.leaveIdSchema?.validateAsync({
    id: req?.params?.id,
  });

  const leave = await leaveService?.deleteLeave(validatedData);
  if (!leave) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Leave not found.');
  }

  const user = await User?.findById(req?.user?.id)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');

  const sendMail = req?.query?.sendMail === 'true';
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending revoke email to ${user?.teamLeadId?.email}`);

    // Format leave date(s)
    let formattedLeaveDates = '';
    const leaveDates = leave?.dates;

    if (!leaveDates || (Array.isArray(leaveDates) && leaveDates.length === 0)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid or missing leave date'
      );
    }

    if (Array.isArray(leaveDates)) {
      const sortedDates = leaveDates
        .map((d) => new Date(d))
        .sort((a, b) => a - b);
      const from = formatDateToKolkata(sortedDates[0]);
      const to = formatDateToKolkata(sortedDates[sortedDates.length - 1]);
      formattedLeaveDates = from === to ? from : `${from} to ${to}`;
    } else {
      formattedLeaveDates = formatDateToKolkata(leaveDates);
    }

    // Send email
    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Revoked leave application',
      message: Helper.WfhLeaveRevoked(
        user?.firstName,
        'leave',
        formattedLeaveDates
      ),
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

module.exports = {
  createLeave,
  getAllLeave,
  getLeaveById,
  updateLeave,
  //   updateDepartment,
  deleteLeave,
};
