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
const LeaveApplication = require('../models/leaveApplicationModel');
const leaveTypeModel = require('../models/leaveTypeModel');

// Get all leave
const getAllLeave = catchAsync(async (req, res) => {
  const currentUser = req.user;
  let leaves;

  if (currentUser.role === 'admin' || currentUser.role === 'hr') {
    // Admin/HR can see all leaves
    leaves = await leaveService?.getAllLeave();
  } else if (
    currentUser.role === 'teamlead' ||
    currentUser.role === 'subteamlead'
  ) {
    // Team leads can see leaves of their team members
    leaves = await leaveService?.getLeaveTl({ id: currentUser.id });
  } else {
    // Regular users can only see their own leaves
    leaves = await leaveService?.getLeaveById({ id: currentUser.id });
  }

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
  const updatedData = await leaveService?.updateLeave(validatedData);

  if (!updatedData) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Leave not found or update failed.'
    );
  }

  const leaveType = await leaveTypeModel
    .findById(updatedData?.leaveTypeId)
    .select('name');


  // Send email notification if status changed
  if (updatedData.status && updatedData.status !== 'pending') {
    const mailReciever = await User.findById(updatedData.userId);
    if (mailReciever?.email) {
      // Format leave date(s)
      let formattedLeaveDates = '';
      const leaveDates = updatedData.dates;

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
        const from = formatDateToKolkata(sortedDates[0]);
        const to = formatDateToKolkata(sortedDates[sortedDates.length - 1]);
        formattedLeaveDates = from === to ? from : `${from} to ${to}`;
      } else {
        formattedLeaveDates = formatDateToKolkata(leaveDates);
      }

      // Send rejection email
      Helper.sendEmail({
        receiverEmails: [mailReciever?.email],
        subject: `Your Leave Request Has Been ${updatedData.status === 'approved' ? 'Approved' : 'Declined'}`,
        message:
          updatedData.status === 'approved'
            ? Helper.leaveWFHApproval(
                mailReciever?.firstName,
                'leave',
                formattedLeaveDates,
                leaveType?.name,
                updatedData?.leaveReason
              )
            : Helper.leaveWFHReject(
                mailReciever?.firstName,
                'leave',
                formattedLeaveDates,
                leaveType?.name,
                // updatedData?.leaveReason
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
    data: updatedData,
  });
});

// delete leave
const deleteLeave = catchAsync(async (req, res) => {
  const userId = req.user.id;
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

const applyForLeave = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id;
    const leaveData = req.body;

    const result = await leaveService.applyForLeave(userId, leaveData);

    if (!result.status) {
      return res.status(400).json({
        success: false,
        message: result.message,
        rejectedReasons: result.rejectedReasons || [],
      });
    }

    const user = await User?.findById(userId)
      .populate('teamLeadId', 'email')
      .populate('subTeamLeadId', 'email');

    const leaveType = await leaveTypeModel
      .findById(result?.data?.leaveTypeId)
      .select('name');
    const from = result?.data?.dates[0];
    const to = result?.data?.dates[result?.data?.dates?.length - 1];
    const leaveReason = result?.data?.leaveReason;

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
          userName: user?.firstName,
          requestType: 'leave',
          leaveType: leaveType?.name || 'Leave',
          fromDate: new Date(from),
          toDate: new Date(to),
          reason: leaveReason,
        }),
      }).catch((err) =>
        logger.error(`Failed to send leave email to ${user?.teamLeadId}:`, err)
      );
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
  // Optionally, add role-based filtering for admin/HR here
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
