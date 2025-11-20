const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * Decrypts AES-256-CBC encrypted data
 * @param {string} encryptedData - Base64 encoded encrypted string
 * @param {string} key - 32-character symmetric key
 * @returns {string} - Decrypted JSON string
 */
function decryptAES256CBC(encryptedData, key) {
  try {
    // Ensure key is exactly 32 characters (pad if needed)
    let symmetricKey = key;
    if (key.length < 32) {
      // Auto-pad like the device does: essl1234 → essl1234111111111111111111111111
      symmetricKey = key.padEnd(32, '1');
    } else if (key.length > 32) {
      symmetricKey = key.substring(0, 32);
    }

    // Decode base64 encrypted data
    const encryptedBuffer = Buffer.from(encryptedData, 'base64');

    // Extract IV (first 16 bytes) and ciphertext (rest)
    const iv = encryptedBuffer.slice(0, 16);
    const ciphertext = encryptedBuffer.slice(16);

    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(symmetricKey), iv);

    // Decrypt
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('AES Decryption Error:', error.message);
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Detects if payload is encrypted (has "data" field with encrypted string)
 * @param {object} payload - Request payload
 * @returns {boolean} - True if encrypted
 */
function isEncrypted(payload) {
  return (
    payload &&
    typeof payload === 'object' &&
    payload.data &&
    typeof payload.data === 'string' &&
    !payload.EmployeeCode // If EmployeeCode exists, it's not encrypted
  );
}

module.exports = {
  decryptAES256CBC,
  isEncrypted,
};

