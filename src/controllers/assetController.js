const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const assetsService = require('../services/assetService');
const assetValidator = require('../validators/assetValidator');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { IT_EMAIL, HR_EMAIL, ADMIN_EMAILS, getTeamEmailConfig } = require('../utility/constants');

const assignAsset = catchAsync(async (req, res) => {
  const data = req.body;
  const assignedId = req.user?.id;
  data.assignedBy = assignedId;

  const validatedData =
    await assetValidator.assetAssignmentSchema.validateAsync(req.body);

  const newAssignment = await assetsService?.assignAsset(validatedData);

  if (!newAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset not assigned successfully.',
    });
  }

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetName, assetType, assignee } = validatedData;
    const employee = await User.findById(assignee);
    const team = req?.user?.team;
    const emailSubject = `Asset Assignment Notification - ${assetName}`;
    const emailMessage = Helper.getAssetAssignmentEmail(
      employee.firstName,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL,
      team,
    );

    const pocEmail = req?.user?.email;
    const configEmails = getTeamEmailConfig(team);

    const receiverEmails = [employee.email];
    const cc = [pocEmail, configEmails?.HR_EMAIL, ...configEmails?.ADMIN_EMAILS];

    logger.info(`Sending asset assignment email to ${employee.email}`);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: true,
      cc,
      team
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
  const team = req?.user?.team;

  const validatedQuery = await assetValidator.getAllUsersSchema.validateAsync({
    page,
    limit,
    search,
  });

  const assignedAssetsResult = await assetsService?.fetchAssignedAssets(
    validatedQuery?.page,
    validatedQuery?.limit,
    validatedQuery?.search,
    team
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
  const updatedRequest = await assetsService?.updateAssignedAsset(
    id,
    validatedData
  );

  const sendMail = req?.body?.sendMail === true;

  if (
    updatedRequest?.status === 'returned' &&
    sendMail &&
    process.env.HRMS_FRONTEND_URL
  ) {
    const employee = await User.findById(updatedRequest.assignee);
    if (employee) {
      const emailSubject = `Asset Returned Confirmation - ${updatedRequest.assetName}`;
      const emailMessage = Helper.getAssetReceivedConfirmationEmail(
        employee.firstName,
        employee.employeeId,
        updatedRequest.assetName,
        updatedRequest.assetType,
        process.env.HRMS_FRONTEND_URL
      );

      const configEmails = getTeamEmailConfig(req.user.team);

      const receiverEmails = [
        configEmails?.HR_EMAIL,
        configEmails?.IT_EMAIL,
        employee?.email,
      ];

      const ccEmails = [
        req.user.email,
        ...configEmails?.ADMIN_EMAILS,
      ].filter(Boolean);

      Helper.sendEmail({
        receiverEmails,
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        fromIt: true,
        cc: ccEmails,
        team:req.user.team,
      }).catch((err) => {
        logger.error(
          `Failed to send asset return confirmation email for ${updatedRequest.assetName}:`,
          err
        );
      });
    }
  }

  // 3. Send Response
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Assigned asset updated successfully.',
    data: updatedRequest,
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
    const { assetName, assetType, assignee, assignedBy } = updatedAssignment;
    const [employee, poc] = await Promise.all([
      User.findById(assignee),
      User.findById(assignedBy),
    ]);


    const emailSubject = `Asset Acknowledgment Confirmation - ${assetName}`;
    const emailMessage = Helper.getAssetAcknowledgmentEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL
    );

    const configEmails = getTeamEmailConfig(req.user.team);

    const receiverEmails = [configEmails?.HR_EMAIL, poc.email, configEmails?.IT_EMAIL, employee?.email];

    const ccEmails = [
      req.user?.email !== employee?.email ? req.user?.email : null,
      ...configEmails?.ADMIN_EMAILS,
    ].filter(Boolean);

    logger.info(
      `Sending asset acknowledgment email to HR for asset ${assetName}`
    );

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIt: false,
      cc: ccEmails,
      team:req.user.team,
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
  const team = req.user.team;

  const assetAssignment = await assetsService.rejectAsset(id, userId);

  if (!assetAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset rejection failed.',
    });
  }

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetName, assetType, assignedBy } = assetAssignment;

    const [employee, poc] = await Promise.all([
      User.findById(userId),
      User.findById(assignedBy),
    ]);

    const emailSubject = `Asset Rejection Notification - ${assetName}`;
    const emailMessage = Helper.getAssetRejectionEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL
    );

    const configEmails = getTeamEmailConfig(team);
    const receiverEmails = [configEmails?.HR_EMAIL, poc.email, configEmails?.IT_EMAIL, employee?.email];

    const ccEmails = [
      req.user?.email !== employee?.email ? req.user?.email : null,
      ...configEmails?.ADMIN_EMAILS,
    ].filter(Boolean);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: false,
      cc: ccEmails,
      team,
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
  const team = req.user.team;

  const validatedData = await assetValidator.returnAssetSchema.validateAsync({
    id,
    userId,
  });

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
    const { assignedBy } = updatedAssignment;
    const [employee, poc] = await Promise.all([
      User.findById({ _id: userId }),
      User.findById(assignedBy),
    ]);
    const { assetName, assetType } = updatedAssignment;

    const emailSubject = `Asset Return Request - ${assetName}`;
    const emailMessage = Helper.getAssetReturnRequestEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL
    );
     
    const configEmails = getTeamEmailConfig(team);
    const receiverEmails = [configEmails?.HR_EMAIL, configEmails?.IT_EMAIL, poc.email].filter(Boolean);
    const ccEmails = [
      employee?.email !== req.user?.email ? req.user?.email : null,
      employee?.email,
      ...configEmails?.ADMIN_EMAILS
    ].filter(Boolean);


    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: false,
      cc:ccEmails,
      team,
    }).catch((err) => {
      logger.error(
        `Failed to send asset return request email to ${employee.email}:`,
        err
      );
    });
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset return request successfully.',
    data: updatedAssignment,
  });
});

const fetchAssetRequests = catchAsync(async (req, res) => {
  const team = req.user.team;
  const assetRequests = await assetsService.fetchAssetRequests(team);
  res.status(httpStatus.OK).json(assetRequests);
});

const handleAssetRequestUpdate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const team = req.user.team;

  const validatedData =
    await assetValidator.handleAssetRequestUpdateSchema.validateAsync({
      id,
      status,
    });

  const updatedRequest = await assetsService.updateAssetRequestStatus(
    validatedData.id,
    validatedData.status
  );

  const sendMail = req?.body?.sendMail;
  const shouldSendEmail = ['return_approved', 'return_rejected'].includes(status.toLowerCase());
  if (sendMail && shouldSendEmail && process.env.HRMS_FRONTEND_URL) {
    const employee = await User.findById(updatedRequest.assignee);
    const { assetName, assetType } = updatedRequest;

    const updStatus = (status === "return_approved") ? "approved" : "rejected";

    const emailSubject = `Asset Return Request ${updStatus.charAt(0).toUpperCase() + updStatus.slice(1)} - ${assetName}`;
    const emailMessage = Helper.getAssetReturnStatusEmail(
      employee.firstName,
      employee.employeeId,
      assetName,
      assetType,
      updStatus,
      process.env.HRMS_FRONTEND_URL
    );
   
    const configEmails = getTeamEmailConfig(team);
    const receiverEmails = [employee.email];
    const ccEmails = [configEmails?.HR_EMAIL, configEmails?.IT_EMAIL, req.user.email, ...configEmails?.ADMIN_EMAILS].filter(Boolean);

    logger.info(`Sending asset return ${updStatus} email to ${employee.email}`);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: true,
      cc:ccEmails,
      team,
    }).catch((err) => {
      logger.error(`Failed to send return ${updStatus} email to ${employee.email}:`, err);
    });
  }


  res.status(httpStatus.OK).json({
    status: true,
    message: `Asset request ${status} successfully.`,
    data: updatedRequest,
  });
});


const getPCDepartmentSummary = catchAsync(async (req, res) => {
  const { user } = req;
  const team = user?.team;

  if (!team) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      status: false,
      message: 'User is not associated with a team.',
    });
  }

  const summary = await assetsService.getPCDepartmentSummary(team);
  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset summary fetched successfully.',
    data: summary,
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
  getPCDepartmentSummary,
};