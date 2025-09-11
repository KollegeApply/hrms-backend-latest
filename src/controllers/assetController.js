const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const assetsService = require('../services/assetService');
const assetRequestService = require('../services/assetRequestService');
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
    const employee = await User.findById(assignee)
      .populate('teamLeadId', 'firstName lastName email')
      .populate('subTeamLeadId', 'firstName lastName email')
      .populate('department', 'name');
    const team = req?.user?.team;
    
    // Construct full names
    const employeeFullName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const teamLeadName = employee?.teamLeadId ? 
      `${employee.teamLeadId.firstName || ''} ${employee.teamLeadId.lastName || ''}`.trim() : 
      (employee?.subTeamLeadId ? 
        `${employee.subTeamLeadId.firstName || ''} ${employee.subTeamLeadId.lastName || ''}`.trim() : 
        'N/A');
    
    const emailSubject = `Asset Assignment Notification - ${assetName}`;
    const emailMessage = Helper.getAssetAssignmentEmail(
      employeeFullName,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL,
      team,
      employee?.jobTitle,
      employee?.employeeId,
      employee?.department?.name,
      teamLeadName
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
    const employee = await User.findById(updatedRequest.assignee)
      .populate('teamLeadId', 'firstName lastName email')
      .populate('subTeamLeadId', 'firstName lastName email')
      .populate('department', 'name');
    if (employee) {
      // Construct full names
      const employeeFullName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
      const teamLeadName = employee?.teamLeadId ? 
        `${employee.teamLeadId.firstName || ''} ${employee.teamLeadId.lastName || ''}`.trim() : 
        (employee?.subTeamLeadId ? 
          `${employee.subTeamLeadId.firstName || ''} ${employee.subTeamLeadId.lastName || ''}`.trim() : 
          'N/A');
      
      const emailSubject = `Asset Returned Confirmation - ${updatedRequest.assetName}`;
      const emailMessage = Helper.getAssetReceivedConfirmationEmail(
        employeeFullName,
        employee.employeeId,
        updatedRequest.assetName,
        updatedRequest.assetType,
        process.env.HRMS_FRONTEND_URL,
        employee?.jobTitle,
        employee?.department?.name,
        teamLeadName
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
      User.findById(assignee)
        .populate('teamLeadId', 'firstName lastName email')
        .populate('subTeamLeadId', 'firstName lastName email')
        .populate('department', 'name'),
      User.findById(assignedBy),
    ]);

    // Construct full names
    const employeeFullName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const teamLeadName = employee?.teamLeadId ? 
      `${employee.teamLeadId.firstName || ''} ${employee.teamLeadId.lastName || ''}`.trim() : 
      (employee?.subTeamLeadId ? 
        `${employee.subTeamLeadId.firstName || ''} ${employee.subTeamLeadId.lastName || ''}`.trim() : 
        'N/A');

    const emailSubject = `Asset Acknowledgment Confirmation - ${assetName}`;
    const emailMessage = Helper.getAssetAcknowledgmentEmail(
      employeeFullName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL,
      employee?.jobTitle,
      employee?.department?.name,
      teamLeadName
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
  const rejectionReason = req?.body?.rejectionReason || '';
  const team = req.user.team;

  const assetAssignment = await assetsService.rejectAsset(id, userId, rejectionReason);

  if (!assetAssignment) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset rejection failed.',
    });
  }

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetName, assetType, assignedBy } = assetAssignment;

    const [employee, poc] = await Promise.all([
      User.findById(userId)
        .populate('teamLeadId', 'firstName lastName email')
        .populate('subTeamLeadId', 'firstName lastName email')
        .populate('department', 'name'),
      User.findById(assignedBy),
    ]);

    // Construct full names
    const employeeFullName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const teamLeadName = employee?.teamLeadId ? 
      `${employee.teamLeadId.firstName || ''} ${employee.teamLeadId.lastName || ''}`.trim() : 
      (employee?.subTeamLeadId ? 
        `${employee.subTeamLeadId.firstName || ''} ${employee.subTeamLeadId.lastName || ''}`.trim() : 
        'N/A');

    const emailSubject = `Asset Rejection Notification - ${assetName}`;
    const emailMessage = Helper.getAssetRejectionEmail(
      employeeFullName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL,
      employee?.jobTitle,
      employee?.department?.name,
      teamLeadName,
      rejectionReason
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
      User.findById({ _id: userId })
        .populate('teamLeadId', 'firstName lastName email')
        .populate('subTeamLeadId', 'firstName lastName email')
        .populate('department', 'name'),
      User.findById(assignedBy),
    ]);
    const { assetName, assetType } = updatedAssignment;

    // Construct full names
    const employeeFullName = `${employee?.firstName || ''} ${employee?.lastName || ''}`.trim();
    const teamLeadName = employee?.teamLeadId ? 
      `${employee.teamLeadId.firstName || ''} ${employee.teamLeadId.lastName || ''}`.trim() : 
      (employee?.subTeamLeadId ? 
        `${employee.subTeamLeadId.firstName || ''} ${employee.subTeamLeadId.lastName || ''}`.trim() : 
        'N/A');

    const emailSubject = `Asset Return Request - ${assetName}`;
    const emailMessage = Helper.getAssetReturnRequestEmail(
      employeeFullName,
      employee.employeeId,
      assetName,
      assetType,
      process.env.HRMS_FRONTEND_URL,
      employee?.jobTitle,
      employee?.department?.name,
      teamLeadName
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
  
  // Fetch both asset requests and asset return requests
  const [assetRequests, assetReturnRequests] = await Promise.all([
    assetRequestService.fetchAssetRequests(1, 1000, '', team),
    assetsService.fetchAssetRequests(team)
  ]);

  // Combine both types of data
  const combinedData = {
    status: true,
    message: 'Asset requests and return requests fetched successfully.',
    data: {
      assetRequests: assetRequests.data || [],
      assetReturnRequests: assetReturnRequests || [],
      pagination: assetRequests.pagination || {}
    }
  };

  res.status(httpStatus.OK).json(combinedData);
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

  const updatedRequest = await assetRequestService.updateAssetRequestStatus(
    validatedData.id,
    validatedData.status,
    req.user.id
  );

  const sendMail = req?.body?.sendMail;
  const shouldSendEmail = ['asset-request-approved', 'asset-request-rejected'].includes(status);
  if (sendMail && shouldSendEmail && process.env.HRMS_FRONTEND_URL) {
    const employee = updatedRequest.requestedBy;
    const { assetType, specifications } = updatedRequest;

    const updStatus = (status === "asset-request-approved") ? "approved" : "rejected";

    const emailSubject = `Asset Request ${updStatus.charAt(0).toUpperCase() + updStatus.slice(1)} - ${assetType}`;
    const emailMessage = Helper.getAssetRequestStatusEmail(
      employee.firstName,
      employee.employeeId,
      assetType,
      specifications,
      updStatus,
      process.env.HRMS_FRONTEND_URL,
      employee?.jobTitle,
      employee?.department?.name,
      teamLeadName
    );
   
    const configEmails = getTeamEmailConfig(team);
    const receiverEmails = [employee.email];
    const ccEmails = [configEmails?.HR_EMAIL, configEmails?.IT_EMAIL, req.user.email, ...configEmails?.ADMIN_EMAILS].filter(Boolean);

    logger.info(`Sending asset request ${updStatus} email to ${employee.email}`);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: true,
      cc:ccEmails,
      team,
    }).catch((err) => {
      logger.error(`Failed to send asset request ${updStatus} email to ${employee.email}:`, err);
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

const createAssetRequest = catchAsync(async (req, res) => {
  const data = req.body;
  const requestedById = req.user?.id;

  const validatedData =
    await assetValidator.createAssetRequestSchema.validateAsync(req.body);
  validatedData.requestedBy = requestedById;

  const newRequest = await assetRequestService?.createAssetRequest(validatedData);

  if (!newRequest) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: false,
      message: 'Asset request not created successfully.',
    });
  }

  const sendMail = req?.body?.sendMail === true;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const { assetType, specifications, neededBy, description } = validatedData;
    const employee = await User.findById(requestedById);
    const team = req?.user?.team;
    const emailSubject = `New Asset Request - ${assetType}`;
    const emailMessage = Helper.getAssetRequestEmail(
      `${employee.firstName} ${employee.lastName}`,
      employee.employeeId,
      assetType,
      specifications,
      neededBy,
      description,
      process.env.HRMS_FRONTEND_URL,
      team,
    );

    const configEmails = getTeamEmailConfig(team);

    const receiverEmails = [configEmails?.HR_EMAIL, configEmails?.IT_EMAIL];
    const cc = [employee.email, ...configEmails?.ADMIN_EMAILS];

    logger.info(`Sending asset request email to HR and IT for ${assetType}`);

    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      fromHR: false,
      fromIT: false,
      cc,
      team
    }).catch((err) => {
      logger.error(
        `Failed to send asset request email for ${assetType}:`,
        err
      );
    });
  }

  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Asset request created successfully.',
    data: newRequest,
  });
});

const fetchAssetRequestsList = catchAsync(async (req, res) => {
  const { page, limit, search } = req.query;
  const team = req?.user?.team;

  const validatedQuery = await assetValidator.getAllUsersSchema.validateAsync({
    page,
    limit,
    search,
  });

  const assetRequestsResult = await assetRequestService?.fetchAssetRequests(
    validatedQuery?.page,
    validatedQuery?.limit,
    validatedQuery?.search,
    team
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset requests fetched successfully.',
    data: assetRequestsResult,
  });
});

const fetchAssetRequestsByUserId = catchAsync(async (req, res) => {
  const userId = req?.user?.id;

  const assetRequests = await assetRequestService?.fetchAssetRequestsByUserId(userId);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Asset requests fetched successfully.',
    data: assetRequests,
  });
});

const fetchTeamAssets = catchAsync(async (req, res) => {
  const { page, limit, search } = req.query;
  const teamLeadId = req?.user?.id;

  const validatedQuery = await assetValidator.getAllUsersSchema.validateAsync({
    page,
    limit,
    search,
  });

  const teamAssetsResult = await assetsService?.fetchTeamAssetsByTeamLead(
    teamLeadId,
    validatedQuery?.page,
    validatedQuery?.limit,
    validatedQuery?.search
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Team assets fetched successfully.',
    data: teamAssetsResult,
  });
});

const updateAssetRequestStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validatedData = await assetValidator.handleAssetRequestUpdateSchema.validateAsync({
    id,
    status,
  });

  const updatedRequest = await assetsService.updateAssetRequestStatus(
    validatedData.id,
    validatedData.status
  );

  res.status(httpStatus.OK).json({
    status: true,
    message: `Asset return request ${status} successfully.`,
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
  getPCDepartmentSummary,
  createAssetRequest,
  fetchAssetRequestsList,
  fetchAssetRequestsByUserId,
  fetchTeamAssets,
  updateAssetRequestStatus,
};