const express = require('express');
const wfhController = require('../controllers/wfhController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/', authenticateUser, wfhController?.createWfh);

// Get all Wfh
router.get('/', authenticateUser, wfhController?.getAllWfh);

// Get Wfh by userId
router.get('/:id', authenticateUser, wfhController?.getWfhById);

// update Wfh
router.put('/:id', authenticateUser, wfhController?.updateWfh);

// delete Wfh by id
router.delete('/:id', authenticateUser, wfhController?.deleteWfh);

module.exports = router;
