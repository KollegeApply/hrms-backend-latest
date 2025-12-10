const biometricWebhookService = require('../services/biometricWebhookService');
const logger = require('../config/logger');

/**
 * Webhook endpoint handler for biometric attendance logs
 * Accepts both encrypted and unencrypted data
 * Returns { "Success": true } as required by eBioserverNew
 */
exports.handleBiometricWebhook = async (req, res) => {
  try {
    logger.info('Biometric webhook received', {
      body: req.body,
      headers: req.headers,
    });

    // Process the webhook data
    const result = await biometricWebhookService.processBiometricWebhook(req.body);

    // Return the required response format
    return res.status(200).send("Success");
  } catch (error) {
    logger.error('Biometric webhook error:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
    });

    // Even on error, return Success: true to prevent device retries
    // (or return false if you want device to retry)
    // Based on requirements, returning true to acknowledge receipt
    return res.status(200).send("Success");
  }
};

