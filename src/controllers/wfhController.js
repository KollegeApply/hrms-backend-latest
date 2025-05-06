const httpStatus = require('http-status-codes');
const wfhService = require('../services/wfhService');
const wfhValidator = require('../validators/wfhValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const HR_EMAIL = require('../utility/constants');
const User = require('../models/userModel');
const { formatDateToKolkata } = require('../utility/common');

const createWfh = catchAsync(async (req, res) => {
  const date = req?.body?.date;
  const wfhReason = req?.body?.wfhReason;
  const userId = req?.user?.id;

  const validatedData = await wfhValidator?.createWfhSchema.validateAsync({
    date: date,
    wfhReason: wfhReason,
    userId: userId,
  });
  // console.log(validatedData);

  const data = await wfhService?.createWfh(validatedData);

  const user = await User.findById(req?.user?.id)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
    logger.info(`Sending wfh email to ${user?.teamLeadId}`);

    // Check if date is valid before formatting
    const parsedDate = new Date(date);
    if (isNaN(parsedDate)) {
      logger.error('Invalid date format passed to WfhLeaveApplication');
      return res
        .status(400)
        .json({ status: false, message: 'Invalid time value' });
    }

    const fromDate = parsedDate;
    const toDate = parsedDate;

    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Applied for wfh',
      message: Helper.WfhLeaveApplication({
        userName: user?.firstName,
        requestType: 'WFH',
        fromDate: fromDate,
        toDate: toDate,
        reason: wfhReason,
      }),
    }).catch((err) =>
      logger.error(`Failed to send wfh email to ${user?.teamLeadId}:`, err)
    );
  }

  res?.status(httpStatus.CREATED).json({
    status: true,
    message: 'WFH created successfully!',
    data: data,
  });
});

// Get all WFH
const getAllWfh = catchAsync(async (req, res) => {
  const wfh = await wfhService?.getAllWfh();

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Wfh retrieved successfully.',
    data: wfh,
  });
});

// // Get wfh by Id
const getWfhById = catchAsync(async (req, res) => {
  const validatedData = await wfhValidator?.wfhIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const user1 = req?.user;
  let wfhFound;
  if (user1?.role === 'teamlead' || user1?.role === 'subteamlead') {
    wfhFound = await wfhService?.getWfhTl(validatedData);
  } else wfhFound = await wfhService?.getWfhById(validatedData);
  if (!wfhFound) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wfh not found.');
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Wfh retrieved successfully.',
    data: wfhFound,
  });
});

// Update wfh
const updateWfh = catchAsync(async (req, res) => {
  const wfhId = req?.params?.id;
  const status = req?.body?.status;
  const edittorId = req?.user?.id;
  const user = req?.user;
  const validatedData = await wfhValidator?.updateWfhSchema?.validateAsync({
    wfhId,
    status,
    edittorId,
    userId: user.id,
  });
  const updated = await wfhService?.updateWfh(validatedData);

  // const userDetail = await User.findById(user.id);

  const mailReciever = await User.findById(updated?.userId);
  // console.log(userDetail);
  if (updated?.status === 'approved') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on WFH request ${mailReciever?.email}`);
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your WFH Request Has Been Approved`,
        message: Helper.leaveWFHApproval(
          mailReciever?.firstName,
          'WFH',
          formatDateToKolkata(updated?.date),
          'Work From Home',
          updated?.wfhReason
        ),
      }).catch((err) =>
        logger.error(
          `Failed to send update on WFH request email to ${mailReciever?.email}:`,
          err
        )
      );
    }
  }
  if (updated?.status === 'rejected') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on WFH request ${mailReciever?.email}`);
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your WFH Request Has Been Declined`,
        message: Helper.leaveWFHReject(
          mailReciever?.firstName,
          'WFH',
          formatDateToKolkata(updated?.date),
          'Work From Home',
          updated?.wfhReason
        ),
      }).catch((err) =>
        logger.error(
          `Failed to send update on WFH request email to ${mailReciever?.email}:`,
          err
        )
      );
    }
  }

  if (!updated) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wfh not found or update failed.');
  }

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Wfh updated successfully.',
    data: updated,
  });
});

// delete wfh
const deleteWfh = catchAsync(async (req, res) => {
  const validatedData = await wfhValidator?.wfhIdSchema?.validateAsync({
    id: req?.params?.id,
  });
  const wfh = await wfhService?.deleteWfh(validatedData);
  if (!wfh) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wfh not found.');
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
      subject: 'Revoked WFH application',
      message: Helper.WfhLeaveRevoked(
        user?.firstName,
        'WFH',
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
    message: 'Wfh deleted successfully.',
    data: wfh,
  });
});

module.exports = {
  createWfh,
  getAllWfh,
  getWfhById,
  updateWfh,
  deleteWfh,
};
