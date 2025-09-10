const express = require('express');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const feedbackController = require("../controllers/feedbackController");
const { USER_ROLES } = require('../utility/constants');
const AIPreprocessingMiddleware = require('../middleware/aiPreprocessingMiddleware');

const router = express.Router();

router.post("/", authenticateUser, AIPreprocessingMiddleware.preprocessFeedback, feedbackController.createFeedback);

router.get("/", authenticateUser, feedbackController.getAllFeedbacks);

router.get("/departments", authenticateUser, feedbackController.getDepartments);

router.get("/:id", authenticateUser, feedbackController.getFeedbackById);

router.get("/:id/trends", authenticateUser, feedbackController.getFeedbackTrends);

router.put("/:id/concern", authenticateUser, feedbackController.raiseConcern);

router.post('/:id/request-edit', authenticateUser, feedbackController.requestEdit);

router.patch("/:id/request-status", authenticateUser, authorizeRole([USER_ROLES?.HR, USER_ROLES?.ADMIN, USER_ROLES?.SUBADMIN]),feedbackController.updateEditRequestStatus);

router.patch('/:id', authenticateUser, feedbackController.updateFeedback);

module.exports = router;
