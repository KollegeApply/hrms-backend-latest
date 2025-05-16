const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const assetsService = require('../services/assetService');
const assetValidator = require('../validators/assetValidator');

const assignAsset = catchAsync(async (req, res) => {
  const data = req.body;
  const assignedId = req.user?.id;
  data.assignedBy = assignedId;

  // 1. Validate the request using the schema
  const validatedData =
    await assetValidator.assetAssignmentSchema.validateAsync(req.body);

  // 2. Delegate the main logic to the service
  const newAssignment = await assetsService?.assignAsset(validatedData);

  // const employee = await User?.findById(req?.body?.employeeId);

  //  const sendMail = req.body.sendMail === true;
  // // 3. Send Email Notification
  //     if (sendMail && process.env.HRMS_FRONTEND_URL) {
  //       logger.info(`Sending asset assignment email to ${employee?.email}`);
  //       console.log(
  //         `Sending asset assignment email to ${employee?.email}`);
  //       const receiverEmails = [
  //         HR_EMAIL,
  //         employee.email,
  //       ].filter(Boolean);

  //       Helper.sendEmail({
  //         receiverEmails,
  //         subject: emailSubject,
  //         message: emailMessage,
  //       }).catch((err) => {
  //         logger.error('Failed to send asset assignment email:', err);
  //         //  IMPORTANT:  Consider NOT throwing an error here.
  //         //  Log the error and continue.
  //       });
  //     }

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

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset acknowledged successfully.',
    data: updatedAssignment,
  });
});

const rejectAsset = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req?.user?.id;

  // 1. Validate the request using the schema
  const validatedData = await assetValidator.rejectAssetSchema.validateAsync({
    id,
    userId,
  });

  // 2. Delegate the main logic to the service
  const updatedAssignment = await assetsService?.rejectAsset(
    validatedData.id,
    validatedData.userId
  );

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset not acknowledged successfully.',
    data: updatedAssignment,
  });
});

module.exports = {
  assignAsset,
  fetchAssignedAssets,
  updateAssignedAsset,
  fetchAssignedAssetByUserId,
  acknowledgeAsset,
  rejectAsset,
};
