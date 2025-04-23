const express = require('express');
const leaveController = require('../controllers/leaveController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', authenticateUser, leaveController?.createLeave);

// Get all Leave
router.get('/', authenticateUser, leaveController?.getAllLeave);

// Get Leave by userId
router.get('/:id', authenticateUser, leaveController?.getLeaveById);

// update leave
router.put('/:id', authenticateUser, leaveController?.updateLeave);

// delete leave by id
router.delete('/:id', authenticateUser, leaveController?.deleteLeave);

module.exports = router;
