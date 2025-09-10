const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const aiTestController = require('../controllers/aiTestController');

const router = express.Router();

// Test AI analysis
router.post('/test', authenticateUser, aiTestController.testAI);

// Get AI service status
router.get('/status', authenticateUser, aiTestController.getAIStatus);

// Test Gemini API connection
router.get('/connection', authenticateUser, aiTestController.testConnection);

module.exports = router;
