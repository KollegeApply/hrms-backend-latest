const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const assetsService = require('../services/assetService');
const assetValidator = require('../validators/assetValidator');
const User = require('../models/userModel');
const Helper = require('../utility/helper');

const assignAsset = catchAsync(async (req, res) => {
  const data = req.body;
  const assignedId = req.user?.id;
  data.assignedBy = assignedId;

  // 1. Validate the request using the schema
  const validatedData =
    await assetValidator.assetAssignmentSchema.validateAsync(req.body);

  // 2. Delegate the main logic to the service
  const newAssignment = await assetsService?.assignAsset(validatedData);

  if (!newAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset not assigned successfully.',
    });
  }

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetName, assetId, assignee } = validatedData;
    const employee = await User.findById(assignee);
    const emailSubject = `Asset Assignment Notification - ${assetName}`;
    const emailMessage = Helper.getAssetAssignmentEmail(
      employee.firstName,
      assetName,
      assetId,
      process.env.HRMS_FRONTEND_URL
    );

    const receiverEmails = [employee.email];

    logger.info(`Sending asset assignment email to ${employee.email}`);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
    }).catch((err) => {
      logger.error(
        `Failed to send asset assignment email to ${employee.email}:`,
        err
      );
    });
  }

  // 4. Send Response
  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Asset assigned successfully.',
    data: newAssignment,
  });
});

const fetchAssignedAssets = catchAsync(async (req, res) => {
  const { page, limit, search } = req.query;

  const validatedQuery = await assetValidator.getAllUsersSchema.validateAsync({
    page,
    limit,
    search,
  });

  const assignedAssetsResult = await assetsService?.fetchAssignedAssets(
    validatedQuery.page,
    validatedQuery.limit,
    validatedQuery.search
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Assigned assets fetched successfully.',
    data: assignedAssetsResult,
  });
});

const updateAssignedAsset = catchAsync(async (req, res) => {
  const { id } = req.params;
  const data = req.body;

  // 1. Validate the request using the schema
  const validatedData =
    await assetValidator.updateAssignedAssetSchema.validateAsync(data);

  // 2. Delegate the main logic to the servicex
  const updatedAssignment = await assetsService?.updateAssignedAsset(
    id,
    validatedData
  );

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Assigned asset updated successfully.',
    data: updatedAssignment,
  });
});

const fetchAssignedAssetByUserId = catchAsync(async (req, res) => {
  const userId = req?.user?.id;

  // 1. Validate the request using the schema
  const validatedData =
    await assetValidator.getAssignedAssetByUserIdSchema.validateAsync({
      userId,
    });

  // 2. Delegate the main logic to the service
  const assignedAsset = await assetsService?.fetchAssignedAssetByUserId(
    validatedData.userId
  );

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Assigned asset fetched successfully.',
    data: assignedAsset,
  });
});

const acknowledgeAsset = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req?.user?.id;

  // 1. Validate the request using the schema
  const validatedData =
    await assetValidator.acknowledgeAssetSchema.validateAsync({ id, userId });

  // 2. Delegate the main logic to the service
  const updatedAssignment = await assetsService?.acknowledgeAsset(
    validatedData.id,
    validatedData.userId
  );

  if (!updatedAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset acknowledgment failed.',
    });
  }

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetName, assetId, assignee } = updatedAssignment;
    const employee = await User.findById(assignee);

    const emailSubject = `Asset Acknowledgment Confirmation - ${assetName}`;
    const emailMessage = Helper.getAssetAcknowledgmentEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetId,
      process.env.HRMS_FRONTEND_URL
    );

    const receiverEmails = [process.env.HR_EMAIL];

    logger.info(
      `Sending asset acknowledgment email to HR for asset ${assetName}`
    );

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
    }).catch((err) => {
      logger.error(
        `Failed to send asset acknowledgment email to HR for asset ${assetName}:`,
        err
      );
    });
  }

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset acknowledged successfully.',
    data: updatedAssignment,
  });
});

const rejectAsset = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const sendMail = req?.body?.sendMail === true;

  const assetAssignment = await assetsService.rejectAsset(id, userId);

  if (!assetAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset rejection failed.',
    });
  }

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const employee = await User.findById(userId);
    const { assetName, assetId } = assetAssignment;

    const emailSubject = `Asset Rejection Notification - ${assetName}`;
    const emailMessage = Helper.getAssetRejectionEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetId,
      process.env.HRMS_FRONTEND_URL
    );

    const receiverEmails = [process.env.HR_EMAIL];

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: true, // or false, depending on sender configuration
    }).catch((err) => {
      logger.error(
        `Failed to send asset rejection email to ${employee.email}:`,
        err
      );
    });
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset rejected successfully.',
    data: assetAssignment,
  });
});

const returnAsset = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req?.user?.id;

  // 1. Validate the request using the schema
  const validatedData = await assetValidator.returnAssetSchema.validateAsync({
    id,
    userId,
  });

  // 2. Delegate the main logic to the service
  const updatedAssignment = await assetsService?.returnAsset(
    validatedData.id,
    validatedData.userId
  );

  if (!updatedAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset return request failed.',
    });
  }

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const employee = await User.findById({ _id: userId });
    const { assetName, assetId } = updatedAssignment;

    const emailSubject = `Asset Return Request - ${assetName}`;
    const emailMessage = Helper.getAssetReturnRequestEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetId,
      process.env.HRMS_FRONTEND_URL
    );

    const receiverEmails = [process.env.HR_EMAIL];

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
    }).catch((err) => {
      logger.error(
        `Failed to send asset return request email to ${employee.email}:`,
        err
      );
    });
  }

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset return request successfully.',
    data: updatedAssignment,
  });
});

const fetchAssetRequests = catchAsync(async (req, res) => {
  const assetRequests = await assetsService.fetchAssetRequests();
  res.status(httpStatus.OK).json(assetRequests);
});

const handleAssetRequestUpdate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validatedData =
    await assetValidator.handleAssetRequestUpdateSchema.validateAsync({
      id,
      status,
    });

  const updatedRequest = await assetsService.updateAssetRequestStatus(
    validatedData.id,
    validatedData.status
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: `Asset request ${status} successfully.`,
    data: updatedRequest,
  });
});

module.exports = {
  assignAsset,
  fetchAssignedAssets,
  updateAssignedAsset,
  fetchAssignedAssetByUserId,
  acknowledgeAsset,
  rejectAsset,
  returnAsset,
  fetchAssetRequests,
  handleAssetRequestUpdate,
};
