const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const feedbackService = require('../services/feedbackService');
const feedbackValidator = require('../validators/feedbackValidator');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { IT_EMAIL, HR_EMAIL, getTeamEmailConfig } = require('../utility/constants');
const feedbackModel = require('../models/feedbackModel');

const createFeedback = catchAsync(async (req, res) => {
  // Handle both formats: { data: { feedback: ... } } and { feedback: ... }
  const data = req?.body?.data || req.body;
  const team = req.user.team;
  
  const validateData = await feedbackValidator.createFeedbackValidator.validateAsync(data);
  
  const feedback = await feedbackService.createFeedback(validateData, req.user);

  if (!feedback) {
    return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: feedback.message });
  }

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const [givenToUser, givenByUser] = await Promise.all([User.findById(feedback.givenTo), User.findById(feedback.givenBy)]);

      if (!givenToUser || !givenByUser) {
        throw new Error('Users not found');
      }

      const configEmails = getTeamEmailConfig(team);

      // 🎯 EMAIL FLOW BASED ON APPROVAL STATUS
      if (feedback.approvalStatus === 'pending_tl_approval') {
        // STL → Employee feedback: Email to Employee's TL for approval (NO CC)
        const employeeTL = await User.findById(givenToUser.teamLeadId);
        
        if (employeeTL) {
          const emailSubject = `STL Feedback Pending Your Approval - ${givenByUser.firstName} ${givenByUser.lastName} to ${givenToUser.firstName} ${givenToUser.lastName}`;
          
          const emailMessage = Helper.getSTLApprovalEmail({
            stlUser: givenByUser,
            employee: givenToUser,
            tlUser: employeeTL,
            dashboardUrl: process.env.HRMS_FRONTEND_URL,
            feedbackId: feedback._id,
            team,
          });

          const receiverEmails = [employeeTL.email];
          // NO CC for approval request - only TL gets the email

          Helper.sendEmail({
            receiverEmails,
            subject: emailSubject,
            message: emailMessage,
            fromHR: false,
            fromIT: false,
            team,
          });

          (`📧 STL approval email sent to TL only: ${employeeTL.email}`);
        }
      } else {
        // Direct feedback: Email to employee immediately
        const emailSubject = `New Feedback Received - ${givenByUser.firstName} ${givenByUser.lastName}`;

        const emailMessage = Helper.getFeedbackEmail({
          givenByUser,
          givenToUser,
          dashboardUrl: process.env.HRMS_FRONTEND_URL,
          feedbackId: feedback._id,
          team,
        });

        const receiverEmails = [givenToUser.email];
        const ccEmails = [configEmails?.HR_EMAIL];

        Helper.sendEmail({
          receiverEmails,
          cc: ccEmails,
          subject: emailSubject,
          message: emailMessage,
          fromHR: false,
          fromIT: false,
          team,
        });

        (`📧 Direct feedback email sent to employee: ${givenToUser.email}`);
      }
    } catch (error) {
      console.error('Error sending feedback email:', error);
    }
  }
  res.status(201).json({ success: true, data: feedback });
}
)

const getAllFeedbacks = catchAsync(async (req, res) => {
  const { id: userId, role: userRole } = req.user;
  
  // Extract filter parameters from query
  const filters = {
    department: req.query.department,
    periodFrom: req.query.periodFrom,
    periodTo: req.query.periodTo,
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search
  };

  const result = await feedbackService.getAllFeedbacks(userId, userRole, req.user.team, filters);

  res.status(200).json({
    success: true,
    data: result.feedbacks,
    pagination: result.pagination
  });
});

// 🎯 TL Approve/Edit STL Feedback
const approveFeedbackByTL = catchAsync(async (req, res) => {
  const { feedbackId } = req.params;
  const { action, editedFeedback, editedRating, comments } = req.body;
  const tlUserId = req.user.id;

  // Validate TL role
  if (req.user.role !== 'teamlead') {
    return res.status(httpStatus.FORBIDDEN).json({
      success: false,
      message: 'Only Team Leads can approve STL feedback'
    });
  }

  const approvalData = {
    action, // 'approve' or 'reject'
    editedFeedback,
    editedRating,
    comments
  };

  const updatedFeedback = await feedbackService.approveFeedbackByTL(
    feedbackId,
    tlUserId,
    approvalData
  );

  // 📧 Send email notification after TL approval/rejection
  ('📧 EMAIL CONDITIONS CHECK:', {
    hasHrmsFrontendUrl: !!process.env.HRMS_FRONTEND_URL,
    frontendUrl: process.env.HRMS_FRONTEND_URL,
    action,
    feedbackId: updatedFeedback._id
  });

  if (process.env.HRMS_FRONTEND_URL) {
    try {
      const team = req.user.team;
      ('📧 Fetching users for email notification...');
      
      const [employee, stlUser, tlUser] = await Promise.all([
        User.findById(updatedFeedback.givenTo),
        User.findById(updatedFeedback.givenBy),
        User.findById(tlUserId)
      ]);

      ('📧 Users fetched:', {
        employee: employee ? `${employee.firstName} ${employee.lastName}` : 'Not found',
        stlUser: stlUser ? `${stlUser.firstName} ${stlUser.lastName}` : 'Not found',
        tlUser: tlUser ? `${tlUser.firstName} ${tlUser.lastName}` : 'Not found'
      });

      if (employee && stlUser && tlUser) {
        const configEmails = getTeamEmailConfig(team);
        
        ('📧 EMAIL DEBUG:', {
          action,
          employeeEmail: employee.email,
          stlEmail: stlUser.email,
          tlEmail: tlUser.email,
          hrEmail: configEmails?.HR_EMAIL,
          approvalStatus: updatedFeedback.approvalStatus
        });

        if (action === 'approve') {
          // Send email to employee (feedback is now approved)
          const emailSubject = `Feedback Approved - ${stlUser.firstName} ${stlUser.lastName}`;
          
          const emailMessage = Helper.getFeedbackApprovedEmail({
            stlUser,
            employee,
            tlUser,
            feedback: updatedFeedback,
            dashboardUrl: process.env.HRMS_FRONTEND_URL,
            feedbackId: updatedFeedback._id,
            team,
          });

          const receiverEmails = [employee.email];
          const ccEmails = [configEmails?.HR_EMAIL];

          Helper.sendEmail({
            receiverEmails,
            cc: ccEmails,
            subject: emailSubject,
            message: emailMessage,
            fromHR: false,
            fromIT: false,
            team,
          });

          (`📧 Feedback approved email sent to employee: ${employee.email}`);
        } else if (action === 'reject') {
          // Send email to STL (feedback was rejected) - NO CC
          const emailSubject = `Feedback Rejected - ${employee.firstName} ${employee.lastName}`;
          
          const emailMessage = Helper.getFeedbackRejectedEmail({
            stlUser,
            employee,
            tlUser,
            comments: comments || 'No reason provided',
            dashboardUrl: process.env.HRMS_FRONTEND_URL,
            team,
          });

          const receiverEmails = [stlUser.email];
          // NO CC for rejection - only STL gets the email

          Helper.sendEmail({
            receiverEmails,
            subject: emailSubject,
            message: emailMessage,
            fromHR: false,
            fromIT: false,
            team,
          });

          (`📧 Feedback rejected email sent to STL only: ${stlUser.email}`);
        }
      }
    } catch (error) {
      console.error('Error sending TL approval email:', error);
    }
  }

  res.status(httpStatus.OK).json({
    success: true,
    data: updatedFeedback,
    message: `Feedback ${action}d successfully`
  });
});

// Get pending STL feedback for TL approval
const getPendingSTLFeedback = catchAsync(async (req, res) => {
  const tlUserId = req.user.id;

  if (req.user.role !== 'teamlead') {
    return res.status(httpStatus.FORBIDDEN).json({
      success: false,
      message: 'Only Team Leads can view pending STL feedback'
    });
  }

  // Find employees under this TL
  const employees = await User.find({
    teamLeadId: tlUserId,
    role: { $in: ['employee', 'intern'] }
  }).select('_id');

  const employeeIds = employees.map(user => user._id);

  // Find pending STL feedback given to these employees
  const pendingFeedback = await feedbackModel.find({
    givenTo: { $in: employeeIds }, // STL feedback TO employees under this TL
    approvalStatus: 'pending_tl_approval',
    'givenBy': { $exists: true } // Ensure givenBy exists
  }).populate('givenBy givenTo', 'firstName lastName email role employeeId')
    .sort({ createdAt: -1 });

  res.status(httpStatus.OK).json({
    success: true,
    data: pendingFeedback,
    message: 'Pending STL feedback retrieved successfully'
  });
});

const getFeedbackById = catchAsync(async (req, res) => {
  const { id: userId, role: userRole } = req.user;
  const feedbackId = req.params.id;

  const feedback = await feedbackService.getFeedbackById(feedbackId, userId, userRole);

  if (!feedback) {
    return res.status(404).json({ success: false, message: "Feedback not found or access denied." });
  }

  res.status(200).json({ success: true, data: feedback });
});

const raiseConcern = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const {role, team} = req.user
  const feedbackId = req.params.id;
  const { reason } = req.body;

  const feedback = await feedbackService.raiseConcern(feedbackId, userId, role, reason);

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const [givenToUser, givenByUser] = await Promise.all([User.findById(feedback.givenTo), User.findById(feedback.givenBy)]);

      if (!givenToUser || !givenByUser) {
        throw new Error('User(s) not found');
      }

      const emailSubject = `Concern Raised on Feedback by ${givenToUser.firstName} ${givenToUser.lastName}`;

      const emailMessage = Helper.getConcernRaiseEmail({
        raisedByUser: givenToUser,
        dashboardUrl: process.env.HRMS_FRONTEND_URL,
        feedbackId: feedback._id,
        team,
      });

      const configEmails = getTeamEmailConfig(team);

      const receiverEmails = [givenByUser.email];
      const ccEmails = [configEmails.HR_EMAIL];

      Helper.sendEmail({
        receiverEmails,
        cc: ccEmails,
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        fromIT: false,
        team,
      });
    } catch (error) {
      console.error('Error sending concern email:', error);
    }
  }


  res.status(200).json({ success: true, message: "Concern raised successfully." });
});

const requestEdit = catchAsync(async (req, res) => {
  const feedbackId = req.params.id;
  const userId = req.user.id;
  const team = req.user.team;

  const feedback = await feedbackService.requestEdit(feedbackId, userId);

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const feedback = await feedbackModel.findById(feedbackId);
      const [givenToUser, givenByUser] = await Promise.all([
        User.findById(feedback.givenTo),
        User.findById(feedback.givenBy)
      ]);

      if (!givenToUser || !givenByUser) {
        throw new Error('Users not found');
      }

      const emailSubject = `Edit Request for Feedback from ${givenByUser.firstName} ${givenByUser.lastName}`;

      const emailMessage = Helper.getEditRequestEmail({
        givenByUser,
        givenToUser,
        dashboardUrl: process.env.HRMS_FRONTEND_URL,
        feedbackId: feedback._id,
        team,
      });

      const configEmails = getTeamEmailConfig(team);
      const receiverEmails = [configEmails?.HR_EMAIL];

      Helper.sendEmail({
        receiverEmails,
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        fromIT: false,
        team,
      });

    } catch (error) {
      console.error('Error sending edit request email:', error);
    }
  }

  return res.status(200).json({ message: "Edit request submitted.", data: feedback });
});

const updateEditRequestStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const team = req.user.team;

  const updatedFeedback = await feedbackService.updateEditRequestStatus(id, status);

  if (!updatedFeedback) {
    return res.status(httpStatus.BAD_REQUEST).json({ message: "Updated Feedback not found" });
  }

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const [givenByUser, givenToUser] = await Promise.all([
        User.findById(updatedFeedback.givenBy),
        User.findById(updatedFeedback.givenTo),
      ]);

      if (!givenByUser || !givenToUser) {
        throw new Error("Users not found");
      }

      const emailSubject = `Your Feedback Edit Request has been ${status}`;
      const emailMessage = Helper.getEditRequestStatusEmail({
        givenByUser,
        givenToUser,
        status,
        dashboardUrl: process.env.HRMS_FRONTEND_URL,
        feedbackId: updatedFeedback._id,
        team,
      });

      const receiverEmails = [givenByUser.email];

      Helper.sendEmail({
        receiverEmails,
        subject: emailSubject,
        message: emailMessage,
        fromHR: true,
        fromIT: false,
        team,
      });

    } catch (error) {
      console.error("Error sending edit request status email:", error);
    }
  }

  return res.status(200).json({
    message: `Feedback edit ${status}`,
    feedback: updatedFeedback,
  });
});

const updateFeedback = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { rating, feedback } = req.body;
  const team = req.user.team;

  const validateData = await feedbackValidator.updateFeedbackValidator.validateAsync({ rating, feedback });

  const updatedFeedback = await feedbackService.updateFeedback(id, validateData);

  if (!updatedFeedback) {
    return res.status(404).json({ message: "Updated Feedback not found" });
  }

  const sendMail = req?.body?.sendMail;

  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const [givenByUser, givenToUser] = await Promise.all([
        User.findById(updatedFeedback.givenBy),
        User.findById(updatedFeedback.givenTo),
      ]);

      if (!givenByUser || !givenToUser) {
        throw new Error("Users not found");
      }

      const emailSubject = `Feedback Updated by ${givenByUser.firstName} ${givenByUser.lastName}`;
      const emailMessage = Helper.getFeedbackUpdatedEmail({
        givenByUser,
        givenToUser,
        dashboardUrl: process.env.HRMS_FRONTEND_URL,
        feedbackId: updatedFeedback._id,
        team,
      });

      const configEmails = getTeamEmailConfig(team);
      const receiverEmails = [givenToUser.email];
      const ccEmails = [configEmails?.HR_EMAIL];
      Helper.sendEmail({
        receiverEmails,
        cc: ccEmails,
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        fromIT: false,
        team,
      });

    } catch (error) {
      console.error("Error sending update feedback email:", error);
    }
  }

  res.status(200).json({
    message: "Feedback updated successfully",
    feedback: updatedFeedback,
  });
});

const getDepartments = catchAsync(async (req, res) => {
  const Department = require('../models/departmentModel');
  
  const departments = await Department.find({ isDeleted: false })
    .select('_id name')
    .sort({ name: 1 });

  res.status(200).json({
    success: true,
    data: departments,
  });
});

const getFeedbackTrends = catchAsync(async (req, res) => {
  const { id: userId, role: userRole } = req.user;
  const feedbackId = req.params.id;

  const trends = await feedbackService.getFeedbackTrends(feedbackId, userId, userRole);

  res.status(200).json({
    success: true,
    data: trends,
  });
});


module.exports = {
  createFeedback,
  getAllFeedbacks,
  getFeedbackById,
  raiseConcern,
  requestEdit,
  updateEditRequestStatus,
  updateFeedback,
  getDepartments,
  getFeedbackTrends,
  approveFeedbackByTL,
  getPendingSTLFeedback,
}