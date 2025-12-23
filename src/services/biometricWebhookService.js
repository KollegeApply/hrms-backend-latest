const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const { decryptAES256CBC, isEncrypted } = require('../utility/aesDecrypt');
const logger = require('../config/logger');

// Get decryption key from environment or use default
const DECRYPTION_KEY =
  process.env.BIOMETRIC_DECRYPTION_KEY;

/**
 * Processes biometric webhook data (encrypted or plain, single or array)
 * @param {object|array} payload - Request payload (can be single object or array)
 * @returns {object} - Result object with success status
 */
async function processBiometricWebhook(payload) {
  try {
    // Handle string payload (should be parsed by express.json, but just in case)
    let processedPayload = payload;
    if (typeof payload === 'string') {
      logger.info('Payload is string, attempting to parse JSON');
      try {
        processedPayload = JSON.parse(payload);
      } catch (parseError) {
        logger.error(
          {
            err: parseError,
            errorMessage: parseError.message,
            payloadString: payload.substring(0, 200), // First 200 chars
          },
          'Failed to parse string payload as JSON'
        );
        throw new Error(`Invalid JSON payload: ${parseError.message}`);
      }
    }

    logger.info('Processing biometric webhook', {
      payloadType: typeof processedPayload,
      isArray: Array.isArray(processedPayload),
      payloadLength: Array.isArray(processedPayload) ? processedPayload.length : (processedPayload ? Object.keys(processedPayload).length : 0),
      payloadKeys: processedPayload && !Array.isArray(processedPayload) ? Object.keys(processedPayload) : 'N/A (array)',
      hasDataField: processedPayload && !Array.isArray(processedPayload) && processedPayload.data ? true : false,
      decryptionKeyExists: !!DECRYPTION_KEY,
      decryptionKeyLength: DECRYPTION_KEY ? DECRYPTION_KEY.length : 0,
      // Only log a safe preview of the key for debugging (do NOT log full key)
      decryptionKeyPreview: DECRYPTION_KEY ? `${DECRYPTION_KEY.slice(0, 4)}****` : null,
    });

    // Handle array of records
    if (Array.isArray(processedPayload)) {
      logger.info(`Processing array of ${processedPayload.length} biometric records`);
      const results = [];
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < processedPayload.length; i++) {
        try {
          logger.debug(`Processing record ${i + 1} of ${processedPayload.length}`);
          const result = await processSingleBiometricRecord(processedPayload[i]);
          results.push(result);
          successCount++;
        } catch (error) {
          errorCount++;
          logger.error(
            {
              err: error,
              errorMessage: error.message,
              recordIndex: i,
              record: processedPayload[i],
            },
            `Error processing record ${i + 1} of ${processedPayload.length}`
          );
          // Continue processing other records even if one fails
        }
      }

      logger.info('Finished processing array', {
        total: processedPayload.length,
        success: successCount,
        errors: errorCount,
      });

      return {
        success: true,
        message: `Processed ${successCount} of ${processedPayload.length} records`,
        data: {
          total: processedPayload.length,
          success: successCount,
          errors: errorCount,
        },
      };
    }

    // Handle single record
    return await processSingleBiometricRecord(processedPayload);
  } catch (error) {
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        payload: payload,
        payloadType: typeof payload,
        isArray: Array.isArray(payload),
      },
      'Error processing biometric webhook'
    );
    throw error;
  }
}

/**
 * Processes a single biometric record (encrypted or plain)
 * @param {object} payload - Single biometric record
 * @returns {object} - Result object with success status
 */
async function processSingleBiometricRecord(payload) {
  try {
    let biometricData;

    // Check if data is encrypted
    if (isEncrypted(payload)) {
      logger.info('Received encrypted biometric data', {
        dataLength: payload.data ? payload.data.length : 0,
        sampleDataStart: payload.data ? payload.data.substring(0, 20) : null,
      });
      
      if (!DECRYPTION_KEY) {
        throw new Error('BIOMETRIC_DECRYPTION_KEY is not set in environment variables');
      }
      
      // Decrypt the data
      const decryptedString = decryptAES256CBC(payload.data, DECRYPTION_KEY);
      logger.debug('Decryption successful, raw decrypted string preview', {
        decryptedPreview: decryptedString.substring(0, 200),
      });

      // Parse JSON with explicit error logging
      try {
        biometricData = JSON.parse(decryptedString);
      } catch (parseError) {
        logger.error(
          {
            err: parseError,
            errorMessage: parseError.message,
            decryptedPreview: decryptedString.substring(0, 500),
          },
          'Failed to parse decrypted biometric JSON'
        );
        throw new Error(`Decrypted JSON parse failed: ${parseError.message}`);
      }
      
      logger.debug('Decrypted biometric data object keys', {
        biometricDataKeys: biometricData ? Object.keys(biometricData) : [],
        employeeCode: biometricData.EmployeeCode,
      });
    } else {
      logger.info('Received plain biometric data', {
        employeeCode: payload?.EmployeeCode,
      });
      biometricData = payload;
    }

    // Validate required fields
    const validationError = validateBiometricData(biometricData);
    if (validationError) {
      logger.error('Biometric data validation failed', {
        validationError,
        biometricDataKeys: Object.keys(biometricData || {}),
        biometricData,
      });
      throw new Error(validationError);
    }

    // Parse dates
    logger.debug('Parsing dates', {
      logDate: biometricData.LogDate,
      downloadDate: biometricData.DownloadDate,
    });
    
    const logDate = parseDate(biometricData.LogDate);
    const downloadDate = parseDate(biometricData.DownloadDate);

    if (!logDate || !downloadDate) {
      logger.error('Invalid date format in biometric data', {
        logDate: biometricData.LogDate,
        downloadDate: biometricData.DownloadDate,
        parsedLogDate: logDate,
        parsedDownloadDate: downloadDate,
      });
      throw new Error(`Invalid date format in biometric data. LogDate: ${biometricData.LogDate}, DownloadDate: ${biometricData.DownloadDate}`);
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
    logger.debug('Attempting to save biometric log to database', {
      employeeCode: biometricData.EmployeeCode,
    });
    
    await biometricLog.save();

    logger.info('Biometric log saved successfully', {
      employeeCode: biometricData.EmployeeCode,
      direction: biometricData.Direction,
      logDate: logDate,
      userId: user ? user._id : null,
      logId: biometricLog._id,
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
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        payload: payload,
      },
      'Error processing single biometric record'
    );
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
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        dateString: dateString,
      },
      'Date parsing error'
    );
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

