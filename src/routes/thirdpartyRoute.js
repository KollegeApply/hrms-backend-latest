const express = require('express');
const thirdPartyController = require('../controllers/thirdPartyController');
const { authenticateUser } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/quotes', authenticateUser, thirdPartyController?.getQuotes);

module.exports = router;
