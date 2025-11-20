const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const { decryptAES256CBC, isEncrypted } = require('../utility/aesDecrypt');
const logger = require('../config/logger');

// Get decryption key from environment or use default
const DECRYPTION_KEY =
  process.env.BIOMETRIC_DECRYPTION_KEY;

/**
 * Processes biometric webhook data (encrypted or plain)
 * @param {object} payload - Request payload
 * @returns {object} - Result object with success status
 */
async function processBiometricWebhook(payload) {
  try {
    let biometricData;

    // Check if data is encrypted
    if (isEncrypted(payload)) {
      logger.info('Received encrypted biometric data');
      
      // Decrypt the data
      const decryptedString = decryptAES256CBC(payload.data, DECRYPTION_KEY);
      biometricData = JSON.parse(decryptedString);
      
      logger.debug('Decrypted biometric data:', { employeeCode: biometricData.EmployeeCode });
    } else {
      logger.info('Received plain biometric data');
      biometricData = payload;
    }

    // Validate required fields
    const validationError = validateBiometricData(biometricData);
    if (validationError) {
      logger.error('Biometric data validation failed:', validationError);
      throw new Error(validationError);
    }

    // Parse dates
    const logDate = parseDate(biometricData.LogDate);
    const downloadDate = parseDate(biometricData.DownloadDate);

    if (!logDate || !downloadDate) {
      throw new Error('Invalid date format in biometric data');
    }

    // Find user by employeeCode (matching employeeId in User model)
    let user = null;
    if (biometricData.EmployeeCode) {
      user = await User.findOne({
        employeeId: biometricData.EmployeeCode,
        isDeleted: { $ne: true },
      }).select('_id employeeId');
    }

    // Parse GPS coordinates
    const gpsCoords = parseGPS(biometricData.GPS);

    // Create biometric log entry
    const biometricLog = new BiometricLog({
      employeeCode: biometricData.EmployeeCode,
      downloadDate: downloadDate,
      logDate: logDate,
      deviceName: biometricData.DeviceName,
      serialNumber: biometricData.SerialNumber,
      direction: biometricData.Direction,
      deviceDirection: biometricData.DeviceDirection,
      workCode: biometricData.WorkCode || '0',
      verificationType: biometricData.VerificationType,
      gps: biometricData.GPS || '0,0',
      user: user ? user._id : null,
      // rawPayload: biometricData,
      wasEncrypted: isEncrypted(payload),
    });

    // Save to database
    await biometricLog.save();

    logger.info('Biometric log saved successfully', {
      employeeCode: biometricData.EmployeeCode,
      direction: biometricData.Direction,
      logDate: logDate,
      userId: user ? user._id : null,
    });

    return {
      success: true,
      message: 'Biometric log processed successfully',
      data: {
        logId: biometricLog._id,
        employeeCode: biometricData.EmployeeCode,
        matchedUser: user ? true : false,
      },
    };
  } catch (error) {
    logger.error('Error processing biometric webhook:', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Validates biometric data structure
 * @param {object} data - Biometric data object
 * @returns {string|null} - Error message or null if valid
 */
function validateBiometricData(data) {
  const requiredFields = [
    'EmployeeCode',
    'DownloadDate',
    'LogDate',
    'DeviceName',
    'SerialNumber',
    'Direction',
    'DeviceDirection',
    'VerificationType',
  ];

  for (const field of requiredFields) {
    if (!data[field]) {
      return `Missing required field: ${field}`;
    }
  }

  // Validate Direction - Commented out temporarily
  // if (!['IN', 'OUT'].includes(data.Direction)) {
  //   return `Invalid Direction: ${data.Direction}. Must be 'IN' or 'OUT'`;
  // }

  // Validate VerificationType - Commented out temporarily
  // const validVerificationTypes = ['Finger', 'Face', 'Card', 'Password'];
  // if (!validVerificationTypes.includes(data.VerificationType)) {
  //   return `Invalid VerificationType: ${data.VerificationType}`;
  // }

  return null;
}

/**
 * Parses date string to Date object
 * @param {string} dateString - Date string in format "YYYY-MM-DD HH:mm:ss"
 * @returns {Date|null} - Parsed date or null if invalid
 */
function parseDate(dateString) {
  if (!dateString) return null;

  try {
    // Format: "2025-01-18 16:28:37"
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch (error) {
    logger.error('Date parsing error:', error.message);
    return null;
  }
}

/**
 * Parses GPS coordinates from string
 * @param {string} gpsString - GPS string in format "latitude,longitude"
 * @returns {object|null} - Object with latitude and longitude or null
 */
function parseGPS(gpsString) {
  if (!gpsString || gpsString === '0,0') {
    return null;
  }

  try {
    const [latitude, longitude] = gpsString.split(',').map(Number);
    if (isNaN(latitude) || isNaN(longitude)) {
      return null;
    }
    return { latitude, longitude };
  } catch (error) {
    return null;
  }
}

module.exports = {
  processBiometricWebhook,
};

