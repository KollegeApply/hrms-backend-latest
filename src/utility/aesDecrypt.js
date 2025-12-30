const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * Decrypts AES-256-CBC encrypted data
 * @param {string} encryptedData - Base64 encoded encrypted string
 * @param {string} key - 32-character symmetric key
 * @returns {string} - Decrypted JSON string
 */
function decryptAES256CBC(encryptedData, key) {
  // Ensure key is exactly 32 characters (pad if needed)
  let symmetricKey = key;
  if (key.length < 32) {
    // Auto-pad like the device does: essl1234 → essl1234111111111111111111111111
    symmetricKey = key.padEnd(32, '1');
  } else if (key.length > 32) {
    symmetricKey = key.substring(0, 32);
  }

  // Basic sanity checks & debug info (without logging full secrets)
  const encryptedLength = encryptedData ? encryptedData.length : 0;
  const looksLikeBase64 = /^[A-Za-z0-9+/=]+$/.test(encryptedData || '');

  logger.debug &&
    logger.debug('Starting AES decryption debug info', {
      encryptedDataLength: encryptedLength,
      looksLikeBase64,
      keyLength: key ? key.length : 0,
    });

  // Decode base64 encrypted data
  const encryptedBuffer = Buffer.from(encryptedData, 'base64');

  // Helper to try a specific IV/ciphertext combo
  const tryDecrypt = (iv, ciphertext, modeLabel) => {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(symmetricKey),
      iv
    );
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const decryptedString = decrypted.toString('utf8');

    logger.debug &&
      logger.debug(`AES decryption successful (${modeLabel}) preview`, {
        decryptedPreview: decryptedString.substring(0, 120),
      });

    const trimmed = decryptedString.trimStart();
    const startsWithJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    return { decryptedString, startsWithJson };
  };

  try {
    // Strategy 1: Device prepends IV as first 16 bytes (our original assumption)
    const ivPrefixed = encryptedBuffer.slice(0, 16);
    const ciphertextPrefixed = encryptedBuffer.slice(16);

    if (ciphertextPrefixed.length > 0) {
      const result1 = tryDecrypt(ivPrefixed, ciphertextPrefixed, 'iv-prefixed');
      if (result1.startsWithJson) {
        return result1.decryptedString;
      }
    }
  } catch (error) {
    // Log and fall through to strategy 2
    logger.warn &&
      logger.warn(
        {
          err: error,
          errorMessage: error.message,
        },
        'AES decryption (iv-prefixed) failed, will try zero-iv strategy'
      );
  }

  try {
    // Strategy 2: eSSL style - fixed zero IV, whole buffer is ciphertext
    const zeroIv = Buffer.alloc(16, 0);
    const ciphertext = encryptedBuffer;
    const result2 = tryDecrypt(zeroIv, ciphertext, 'zero-iv-full-ciphertext');
    const trimmed2 = result2.decryptedString.trimStart();
    if (result2.startsWithJson) {
      return result2.decryptedString;
    }

    // Even if it doesn't look like JSON, return it; caller will handle parse errors
    return result2.decryptedString;
  } catch (error) {
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        encryptedDataLength: encryptedData ? encryptedData.length : 0,
        keyLength: key ? key.length : 0,
      },
      'AES Decryption Error'
    );
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

