const express = require('express');
const biometricWebhookController = require('../controllers/biometricWebhookController');

const router = express.Router();

// Webhook endpoint - no authentication required (public endpoint for device)
// POST /webhook/biometric
router.post('/biometric', biometricWebhookController.handleBiometricWebhook);

module.exports = router;

