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
      bodyType: typeof req.body,
      isArray: Array.isArray(req.body),
      bodyLength: Array.isArray(req.body) ? req.body.length : (req.body ? Object.keys(req.body).length : 0),
      bodyKeys: req.body && !Array.isArray(req.body) ? Object.keys(req.body) : 'N/A (array)',
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    });

    // Process the webhook data (handles both single object and array)
    const result = await biometricWebhookService.processBiometricWebhook(req.body);

    // Return the required response format
    return res.status(200).send("Success");
  } catch (error) {
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        body: req.body,
        bodyKeys: req.body && !Array.isArray(req.body) ? Object.keys(req.body || {}) : 'N/A',
        bodyType: typeof req.body,
        isArray: Array.isArray(req.body),
      },
      'Biometric webhook error'
    );

    // Even on error, return Success: true to prevent device retries
    // (or return false if you want device to retry)
    // Based on requirements, returning true to acknowledge receipt
    return res.status(200).send("Success");
  }
};

