const express = require('express');
const attendanceController = require('../controllers/attendanceController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

// Protected routes - require authentication
router.use(authenticateUser);

// Mark attendance
router.post('/check-in', attendanceController.markCheckIn);
router.post('/check-out', attendanceController.markCheckOut);
router.post('/apply-leave', attendanceController.applyForLeave);
router.post('/apply-wfh', attendanceController.applyForWFH);
router.get('/today-check-in', attendanceController.getTodayCheckIn);
// Get attendance
router.get('/', attendanceController.getAttendance);

module.exports = router;