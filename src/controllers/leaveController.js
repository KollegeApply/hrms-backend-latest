const httpStatus = require('http-status-codes');
const leaveService = require('../services/leaveService');
const leaveValidator = require('../validators/leaveValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const { HR_EMAIL } = require('../utility/constants');
const User = require('../models/userModel');

const createLeave = catchAsync(async (req, res) => {
  const date = req?.body?.date;
  const leaveReason = req?.body?.leaveReason;
  const leaveType = req?.body?.leaveType;
  const userId = req?.user?.id;

  const validatedData = await leaveValidator?.createLeaveSchema?.validateAsync({
    date: date,
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
    logger.info(`Sending leave email to ${user?.teamLead}`);
    Helper.sendEmail({
      receiverEmails: [
        HR_EMAIL,
        user?.teamLeadId?.email,
        user?.subTeamLeadId?.email,
      ],
      subject: 'Applied for leave',
      message: Helper.getWelcomeEmail(
        data?.leaveReason,
        data?.date,
        user?.role,
        validatedData?.password, // !! SECURITY RISK: Avoid sending plain password
        process?.env?.HRMS_FRONTEND_URL
      ),
    }).catch((err) =>
      logger.error(`Failed to send welcome email to ${user?.email}:`, err)
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

  // const userDetail = await User.findById(user.id);
  const mailReciever = await User.findById(updated?.userId);
  // console.log(userDetail);
  if (updated?.status === 'approved') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on leave request ${mailReciever?.email}`);
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Approved`,
        message: Helper.leaveWFHApproval(
          mailReciever?.firstName,
          'leave',
          updated?.date,
          updated?.leaveType,
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
  if (updated?.status === 'rejected') {
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(`Update on leave request ${mailReciever?.email}`);
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been Declined`,
        message: Helper.leaveWFHReject(
          mailReciever?.firstName,
          'leave',
          updated?.date,
          updated?.leaveType,
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
