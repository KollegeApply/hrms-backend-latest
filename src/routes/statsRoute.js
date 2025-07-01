const express = require('express');
const { authenticateUser } = require('../middleware/authMiddleware');
const statsController = require('../controllers/statsController');

const router = express.Router();

// Monthly Stats
router.get('/monthly', authenticateUser, statsController?.getMonthlyStats);

// Yearly Stats
router.get('/yearly', authenticateUser, statsController.getYearlyStats);

// // Leave Stats
// router.get('/leave', authenticateUser, statsController.getLeaveStats);

module.exports = router;