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

      const emailSubject = `Feedback Notification - ${givenByUser.firstName} ${givenByUser.lastName} to ${givenToUser.firstName} ${givenToUser.lastName}`;

      const emailMessage = Helper.getFeedbackEmail({
        givenByUser,
        givenToUser,
        dashboardUrl: process.env.HRMS_FRONTEND_URL,
        feedbackId: feedback._id,
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
      console.error('Error sending create feedback email:', error);
    }
  }
  res.status(201).json({ success: true, data: feedback });
}
)

const getAllFeedbacks = catchAsync(async (req, res) => {
  const { id: userId, role: userRole, team: userTeam } = req.user;
  
  // Extract filter parameters from query
  const filters = {
    department: req.query.department,
    periodFrom: req.query.periodFrom,
    periodTo: req.query.periodTo,
    page: req.query.page,
    limit: req.query.limit
  };

  const result = await feedbackService.getAllFeedbacks(userId, userRole, userTeam, filters);

  res.status(200).json({
    success: true,
    data: result.feedbacks,
    pagination: result.pagination
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
}