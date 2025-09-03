const regularizationService = require('../services/regularizationService');
const catchAsync = require('../utility/catchAsync');
const Helper = require('../utility/helper');
const User = require('../models/userModel');
const moment = require('moment-timezone');
const { getTeamEmailConfig } = require('../utility/constants');
const logger = require('../config/logger');
const { uploadToAzure } = require('../utility/azureBlob');

const regularizationController = {
  // Get regularization limits for user
  getRegularizationLimits: catchAsync(async (req, res) => {
    const { user } = req;
    const limits = await regularizationService.getRegularizationLimits(user._id);
    
    res.status(200).json({
      status: 'success',
      data: limits
    });
  }),

  // Create regularization request
  createRegularization: catchAsync(async (req, res) => {
    const { user } = req;
    const regularizationData = req.body;
    
    // Handle file upload for emergency type
    if (req.file && regularizationData.type === 'emergency') {
      try {
        // Clean the file name for regularization uploads
        const cleanFileName = req.file.originalname
          .replace(/[^\w.-]/g, '_') // Replace special characters with underscore
          .replace(/\s+/g, '_') // Replace spaces with underscore
          .replace(/_+/g, '_') // Replace multiple underscores with single underscore
          .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
        
        const relativePath = await uploadToAzure(req.file.buffer, cleanFileName, 'hrms-regularization-documents/');
        regularizationData.evidence = relativePath;
      } catch (error) {
        logger.error('Error uploading file to Azure:', error);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to upload evidence document'
        });
      }
    }

    const result = await regularizationService.createRegularization(user._id, regularizationData);

    // Send email notification to Team Lead
    if (result.status === 'success') {
      try {
        await sendRegularizationStatusUpdateEmail(result.data, 'new_request', user.team);
      } catch (error) {
        logger.error('Error sending regularization email notification:', error);
        // Don't fail the request if email fails
      }
    }

    res.status(201).json(result);
  }),

  // Get all regularization requests
  getRegularizations: catchAsync(async (req, res) => {
    const { user } = req;
    const filters = req.query;

    const result = await regularizationService.getRegularizations(user._id, user.role, filters);

    res.status(200).json(result);
  }),

  // Get regularization by ID
  getRegularizationById: catchAsync(async (req, res) => {
    const { user } = req;
    const { id } = req.params;

    const result = await regularizationService.getRegularizationById(id, user._id, user.role);

    res.status(200).json(result);
  }),

  // Approve regularization request
  approveRegularization: catchAsync(async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const { comment } = req.body;

    const result = await regularizationService.approveRegularization(id, user._id, user.role, comment);

    // Send email notification to employee
    if (result.status === 'success') {
      try {
        // Determine the action based on the new status, not just user role
        let action;
        if (result.data.regularization.status === 'hr-pending') {
          action = 'hr-pending'; // Team lead approval (including HR acting as team lead)
        } else if (result.data.regularization.status === 'approved') {
          action = 'approved'; // HR approval
        } else {
          // Fallback to role-based logic
          action = user.role === 'teamlead' ? 'hr-pending' : 'approved';
        }
        await sendRegularizationStatusUpdateEmail(result.data, action, user.team);
      } catch (error) {
        logger.error('Error sending regularization approval email notification:', error);
        // Don't fail the request if email fails
      }
    }

    res.status(200).json(result);
  }),

  // Reject regularization request
  rejectRegularization: catchAsync(async (req, res) => {
    const { user } = req;
    const { id } = req.params;
    const { reason } = req.body;

    const result = await regularizationService.rejectRegularization(id, user._id, user.role, reason);

    // Send email notification to employee
    if (result.status === 'success') {
      try {
        // Determine the action based on the new status, not just user role
        let action;
        if (result.data.regularization.status === 'tl-rejected') {
          action = 'tl-rejected'; // Team lead rejection (including HR acting as team lead)
        } else if (result.data.regularization.status === 'hr-rejected') {
          action = 'hr-rejected'; // HR rejection
        } else {
          // Fallback to role-based logic
          action = user.role === 'teamlead' ? 'tl-rejected' : 'hr-rejected';
        }
        await sendRegularizationStatusUpdateEmail(result.data, action, user.team, reason);
      } catch (error) {
        logger.error('Error sending regularization rejection email notification:', error);
        // Don't fail the request if email fails
      }
    }

    res.status(200).json(result);
  }),

  // Delete regularization request
  deleteRegularization: catchAsync(async (req, res) => {
    const { user } = req;
    const { id } = req.params;

    const result = await regularizationService.deleteRegularization(id, user._id);

    // Send email notification for revocation
    if (result.status === 'success') {
      try {
        await sendRegularizationStatusUpdateEmail(result.data, 'revoked', user.team);
      } catch (error) {
        logger.error('Error sending regularization revocation email notification:', error);
        // Don't fail the request if email fails
      }
    }

    res.status(200).json(result);
  }),

  // Get pending approvals
  getPendingApprovals: catchAsync(async (req, res) => {
    const { user } = req;

    const result = await regularizationService.getPendingApprovals(user._id, user.role);

    res.status(200).json(result);
  }),


};

async function sendRegularizationStatusUpdateEmail(attendance, action, team, rejectionReason = '') {
  // Add null checks for attendance and regularization
  if (!attendance) {
    logger.error('sendRegularizationStatusUpdateEmail: attendance is undefined');
    return;
  }
  
  if (!attendance.regularization) {
    logger.error(`sendRegularizationStatusUpdateEmail: regularization is undefined for attendance ID: ${attendance._id}`);
    return;
  }
  
  const regularization = attendance.regularization;
  const employee = await User.findById(attendance.user)
    .populate('teamLeadId', 'email firstName lastName')
    .populate('subTeamLeadId', 'email firstName lastName')
    .populate('department', 'name');

  if (!employee) {
    logger.error(`Could not find employee for regularization ID: ${attendance._id}`);
    return;
  }

  const configEmails = getTeamEmailConfig(team);
  let emailSubject = '', emailMessage = '', receiverEmails = [], ccEmails = [];

  const formattedDate = moment(regularization.requestedCheckInTime).format('DD MMMM YYYY');
  const checkInTime = moment(regularization.requestedCheckInTime).format('hh:mm A');
  const checkOutTime = moment(regularization.requestedCheckOutTime).format('hh:mm A');

  switch (action) {
    case 'new_request':
      // When apply then to TL, cc HR
      emailSubject = 'New Regularization Request';
      emailMessage = Helper.regularizationNotificationEmail(
        employee.teamLeadId?.firstName || 'Team Lead',
        employee.firstName,
        employee.lastName,
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        regularization.type,
        attendance._id,
        team,
        employee.employeeId,
        employee.jobTitle,
        employee.department?.name || 'N/A'
      );
      receiverEmails = [employee.teamLeadId?.email].filter(Boolean);
      ccEmails = [configEmails.HR_EMAIL].filter(Boolean);
      break;
      
    case 'hr-pending':
      // When tl-approved then to HR, cc Employee
      emailSubject = 'Regularization Request - Team Lead Approved';
      emailMessage = Helper.regularizationHRPendingNotification(
        employee.firstName,
        employee.lastName,
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        regularization.type,
        team,
        employee.employeeId,
        employee.jobTitle,
        employee.department?.name || 'N/A'
      );
      receiverEmails = [configEmails.HR_EMAIL];
      ccEmails = [employee.email].filter(Boolean);
      break;
      
    case 'tl-rejected':
      // When tl-rejected then to Employee, cc HR
      emailSubject = 'Regularization Request Rejected by Team Lead';
      emailMessage = Helper.regularizationDecisionEmail(
        employee.firstName,
        'Team Lead',
        'Reviewer',
        'tl-rejected',
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        rejectionReason,
        team,
        employee.employeeId,
        employee.jobTitle,
        employee.department?.name || 'N/A'
      );
      receiverEmails = [employee.email];
      ccEmails = [configEmails.HR_EMAIL].filter(Boolean);
      break;
      
    case 'approved':
      // When approved then to Employee, cc TL
      emailSubject = 'Regularization Request Approved';
      emailMessage = Helper.regularizationDecisionEmail(
        employee.firstName,
        'HR',
        'Reviewer',
        'approved',
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        '',
        team,
        employee.employeeId,
        employee.jobTitle,
        employee.department?.name || 'N/A'
      );
      receiverEmails = [employee.email];
      ccEmails = [employee.teamLeadId?.email].filter(Boolean);
      break;
      
    case 'hr-rejected':
      // When hr-rejected then to Employee, cc TL
      emailSubject = 'Regularization Request Rejected by HR';
      emailMessage = Helper.regularizationDecisionEmail(
        employee.firstName,
        'HR',
        'Reviewer',
        'hr-rejected',
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        rejectionReason,
        team,
        employee.employeeId,
        employee.jobTitle,
        employee.department?.name || 'N/A'
      );
      receiverEmails = [employee.email];
      ccEmails = [employee.teamLeadId?.email].filter(Boolean);
      break;
      
    case 'revoked':
      // When empl revoked to TL, cc HR
      emailSubject = 'Regularization Request Revoked by Employee';
      emailMessage = Helper.regularizationRevokedEmail(
        employee.firstName,
        formattedDate,
        checkInTime,
        checkOutTime,
        regularization.reason,
        team
      );
      receiverEmails = [employee.teamLeadId?.email].filter(Boolean);
      ccEmails = [configEmails.HR_EMAIL].filter(Boolean);
      break;
  }

  if (receiverEmails.length) {
    Helper.sendEmail({
      receiverEmails,
      subject: emailSubject,
      message: emailMessage,
      cc: ccEmails,
      team,
    }).catch(err => logger.error(`Failed to send regularization notification for regularization ID ${attendance._id}:`, err));
  }
}

module.exports = regularizationController;
