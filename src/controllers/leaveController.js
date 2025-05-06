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

  // Pass validated data to the service
  const data = await leaveService?.createLeave(validatedData);

  // Populate user data
  const user = await User?.findById(req?.user?.id)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');

  // Define sendMail flag
  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    let leaveMessage = '';
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // If leave is for a single day
    if (fromDate.toDateString() === toDate.toDateString()) {
      leaveMessage = `Leave applied for: ${fromDate.toDateString()}`;
    }
    // If leave is for multiple days
    else {
      leaveMessage = `Leave applied from ${fromDate.toDateString()} to ${toDate.toDateString()}`;
    }

    // Sending leave email with the appropriate message
    logger.info(`Sending leave email to ${user?.teamLeadId}`);
    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Leave Applied',
      message: Helper.WfhLeaveApplication(
        user?.firstName,
        'Leave',
        LEAVETYPES[leaveType] || 'Monthly Leave',
        formatDateToKolkata(fromDate),
        leaveReason,
        leaveMessage
      ),
    }).catch((err) =>
      logger.error(`Failed to send leave email to ${user?.teamLeadId}:`, err)
    );
  }

  // Respond with success
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

  // Get the mail receiver details
  const mailReciever = await User.findById(updated?.userId);

  // Handle email sending for approved leave
  if (updated?.status === 'approved') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on leave request ${mailReciever?.email}`);

      // Determine leave message and date formatting
      let leaveMessage = '';
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

      if (Array.isArray(leaveDates)) {
        const sortedDates = leaveDates
          .map((d) => new Date(d))
          .sort((a, b) => a - b);
        const fromDate = sortedDates[0];
        const toDate = sortedDates[sortedDates.length - 1];

        if (fromDate.toDateString() === toDate.toDateString()) {
          leaveMessage = `Leave approved for: ${fromDate.toDateString()}`;
        } else {
          leaveMessage = `Leave approved from ${fromDate.toDateString()} to ${toDate.toDateString()}`;
        }
      } else {
        const singleDate = new Date(leaveDates);
        leaveMessage = `Leave approved for: ${singleDate.toDateString()}`;
      }

      // Send approval email
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Approved`,
        message: Helper.leaveWFHApproval(
          mailReciever?.firstName,
          'leave',
          Array.isArray(leaveDates)
            ? leaveDates.map(formatDateToKolkata).join(', ')
            : formatDateToKolkata(leaveDates),
          LEAVETYPES[updated?.leaveType],
          updated?.leaveReason,
          leaveMessage
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
      let leaveMessage = '';
      const leaveDates = updated?.date;

      if (
        !leaveDates ||
        (Array.isArray(leaveDates) && leaveDates.length === 0)
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid or missing leave date'
        );
      }

      if (Array.isArray(leaveDates)) {
        const sortedDates = leaveDates
          .map((d) => new Date(d))
          .sort((a, b) => a - b);
        const fromDate = sortedDates[0];
        const toDate = sortedDates[sortedDates.length - 1];

        if (fromDate.toDateString() === toDate.toDateString()) {
          leaveMessage = `Leave declined for: ${fromDate.toDateString()}`;
        } else {
          leaveMessage = `Leave declined from ${fromDate.toDateString()} to ${toDate.toDateString()}`;
        }
      } else {
        const singleDate = new Date(leaveDates);
        leaveMessage = `Leave declined for: ${singleDate.toDateString()}`;
      }

      // Send rejection email
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Declined`,
        message: Helper.leaveWFHReject(
          mailReciever?.firstName,
          'leave',
          Array.isArray(leaveDates)
            ? leaveDates.map(formatDateToKolkata).join(', ')
            : formatDateToKolkata(leaveDates),
          LEAVETYPES[updated?.leaveType],
          updated?.leaveReason,
          leaveMessage
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

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending revoke email to ${user?.teamLeadId}`);
    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Revoked leave application',
      message: Helper.WfhLeaveRevoked(
        user?.firstName,
        'Leave',
        formatDateToKolkata(validatedData?.date)
      ),
    }).catch((err) =>
      logger.error(
        `Failed to send revoke email to ${user?.teamLeadId} and others:`,
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
