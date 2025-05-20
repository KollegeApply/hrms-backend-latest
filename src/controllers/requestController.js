const { StatusCodes } = require('http-status-codes');
const requestService = require('../services/requestService');
const requestValidator = require('../validators/requestValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const AttendanceModel = require('../models/attendanceModel');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { HR_EMAIL, REQUEST_TYPES, LEAVETYPES } = require('../utility/constants');
const logger = require('../config/logger');

const createRequest = catchAsync(async (req, res) => {
  console.log('create-req-hit');
  const { userId, requestType, requestDescription, backDatedCheckIn } =
    req.body; // Include backDatedCheckIn

  const validatedData =
    await requestValidator.createRequestSchema.validateAsync({
      userId,
      requestType,
      requestDescription,
      backDatedCheckIn, // Include in validation if you have a specific schema for it
    });

  const data = await requestService.createRequest(validatedData);

  const user = await User?.findById(userId)
    .populate('teamLeadId', 'email')
    .populate('subTeamLeadId', 'email');

  logger.info('Trig');

  // const sendMail = req?.body?.sendMail === true;
  // if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
  //   logger.info(`Sending request email to ${user?.teamLeadId}`);
  //   Helper.sendEmail({
  //     receiverEmails: [
  //       HR_EMAIL,
  //       user?.teamLeadId?.email,
  //       user?.subTeamLeadId?.email,
  //     ],
  //     subject: 'Request Generated',
  //     message: Helper.WfhLeaveApplication({
  //       userName: user?.firstName,
  //       requestType: 'leave',
  //       leaveType: LEAVETYPES[leaveType] || 'Monthly Leave',
  //       fromDate: new Date(),
  //       toDate: new Date(),
  //       reason: requestDescription,
  //     }),
  //     fromh,
  //   }).catch((err) =>
  //     logger.error(`Failed to send leave email to ${user?.teamLeadId}:`, err)
  //   );
  // }

  res.status(StatusCodes.CREATED).json({
    status: true,
    message: 'Request created successfully!',
    requestStatus: 'Pending',
    data,
  });
});

const getAllRequests = catchAsync(async (req, res) => {
  const requests = await requestService.getAllRequests();

  res.status(StatusCodes.OK).json({
    status: true,
    message: 'Requests retrieved successfully.',
    data: requests,
  });
});

const getRequestById = catchAsync(async (req, res) => {
  const validatedData = await requestValidator.requestIdSchema.validateAsync({
    id: req.params.id,
  });

  const found = await requestService.getRequestById(validatedData);

  if (!found) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Request not found.');
  }

  res.status(StatusCodes.OK).json({
    status: true,
    message: 'Request retrieved successfully.',
    data: found,
  });
});

const getRequestsByUser = catchAsync(async (req, res) => {
  const requesterId = req.user?.id; // Authenticated user
  const targetUserId = req.params?.userId;

  // Restrict users from accessing others’ data unless admin, hr or subadmin
  if (
    requesterId !== targetUserId &&
    !['ADMIN', 'HR', 'SUBADMIN'].includes(req.user?.role)
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Access denied.');
  }

  const validatedData = await requestValidator.userIdSchema.validateAsync({
    userId: targetUserId,
  });

  const userRequests = await requestService.getRequestsByUser(
    validatedData.userId
  );

  res.status(StatusCodes.OK).json({
    status: true,
    message: 'Requests retrieved successfully.',
    data: userRequests,
  });
});

const updateRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const updateFields = req.body;
  const userId = req.user?.id;

  const validatedData =
    await requestValidator.updateRequestSchema.validateAsync({
      id,
      ...updateFields,
      updatedBy: userId,
    });

  const attendanceCreated = await createAttendance(req.body, id);

  if (!attendanceCreated) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      status: false,
      message: 'Failed to generate attendance record. Request update aborted.',
    });
  }

  const updated = await requestService.updateRequest(validatedData);

  if (!updated) {
    return res.status(StatusCodes.NOT_FOUND).json({
      status: false,
      message: 'Request not found or update failed.',
    });
  }

  return res.status(StatusCodes.OK).json({
    status: true,
    message: 'Request updated successfully. Attendance record generated.',
    data: updated,
  });
});

const createAttendance = async (body, requestId) => {
  try {
    const { userId, date } = body;
    const attendanceDate = date;

    const newAttendance = await AttendanceModel.create({
      user: userId,
      date: attendanceDate,
      status: 'present',
      backdatedId: requestId,
    });
    return !!newAttendance;
  } catch (error) {
    console.error('Error creating attendance:', error.message);
    return false;
  }
};

const deleteRequest = catchAsync(async (req, res) => {
  const validatedData = await requestValidator.requestIdSchema.validateAsync({
    id: req.params.id,
  });

  const deleted = await requestService.deleteRequest(validatedData);

  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Request not found.');
  }

  res.status(StatusCodes.OK).json({
    status: true,
    message: 'Request deleted successfully.',
    data: deleted,
  });
});

module.exports = {
  createRequest,
  getAllRequests,
  getRequestById,
  getRequestsByUser,
  updateRequest,
  deleteRequest,
};
