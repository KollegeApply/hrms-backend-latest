const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const logger = require('../config/logger');
const feedbackService = require('../services/feedbackService');
const feedbackValidator = require('../validators/feedbackValidator');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { IT_EMAIL, HR_EMAIL } = require('../utility/constants');

const createFeedback = catchAsync(async (req, res) => {
    const data = req?.body?.data;
    const validateData = await feedbackValidator.createFeedbackValidator.validateAsync(data);
    const feedback = await feedbackService.createFeedback(validateData, req.user);
    res.status(201).json({ success: true, data: feedback });
}
)

const getAllFeedbacks = catchAsync(async (req, res) => {
  const { id: userId, role: userRole } = req.user;

  const feedbacks = await feedbackService.getAllFeedbacks(userId, userRole);

  res.status(200).json({
    success: true,
    data: feedbacks,
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
  const role = req.user.role;
  const feedbackId = req.params.id;
  const { reason } = req.body;

  const result = await feedbackService.raiseConcern(feedbackId, userId, role, reason);

  if (!result.success) {
    return res.status(403).json({ success: false, message: result.message });
  }

  res.status(200).json({ success: true, message: "Concern raised successfully." });
});

const requestEdit = async (req, res) => {
  const feedbackId = req.params.id;
  const userId = req.user.id;

  try {
    const result = await feedbackService.requestEdit(feedbackId, userId);
    return res.status(200).json({ message: "Edit request submitted.", data: result });
  } catch (error) {
    console.error("Edit request error:", error);
    return res.status(400).json({ message: error.message || "Failed to request edit." });
  }
};

const updateEditRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updatedFeedback = await feedbackService.updateEditRequestStatus(id, status);

    return res.status(200).json({
      message: `Feedback edit ${status}`,
      feedback: updatedFeedback,
    });
  } catch (error) {
    console.error("Error updating edit request status:", error.message);
    return res.status(
      error.message === "Feedback not found" || error.message === "Invalid status" ? 400 : 500
    ).json({ message: error.message || "Internal server error" });
  }
};

const updateFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, feedback} = req.body;

    const validateData = await feedbackValidator.updateFeedbackValidator.validateAsync({rating,feedback});

    const updatedFeedback = await feedbackService.updateFeedback(id, validateData);

    if (!updatedFeedback) {
      return res.status(404).json({ message: "Feedback not found" });
    }

    res.status(200).json({
      message: "Feedback updated successfully",
      feedback: updatedFeedback,
    });
  } catch (error) {
    console.error("Error updating feedback:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


module.exports = {
    createFeedback,
    getAllFeedbacks,
    getFeedbackById,
    raiseConcern,
    requestEdit,
    updateEditRequestStatus,
    updateFeedback,
}