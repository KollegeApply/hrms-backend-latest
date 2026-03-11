const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const Attendance = require('../models/attendanceModel');
const { decryptAES256CBC, isEncrypted } = require('../utility/aesDecrypt');
const logger = require('../config/logger');
const moment = require('moment-timezone');

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

    // Toggle to enable/disable decryption logic.
    // For now, encryption is disabled so that we can test plain JSON payloads from ESSL.
    const ENCRYPTION_ENABLED = false;

    // Check if data is encrypted (only when encryption handling is enabled)
    if (ENCRYPTION_ENABLED && isEncrypted(payload)) {
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
      // TEMPORARY: Treat all payloads as plain biometric JSON (no decryption)
      logger.info('Received plain biometric data (encryption handling disabled)', {
        employeeCode: payload?.EmployeeCode,
        payloadKeys: payload ? Object.keys(payload) : [],
        hasDataField: !!payload?.data,
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

    // Parse & normalize dates from device (always treated as IST wall-clock or explicit UTC)
    logger.debug('Parsing dates', {
      rawLogDateString: biometricData.LogDate,
      rawDownloadDateString: biometricData.DownloadDate,
    });

    const logDate = normalizeDeviceLogDateToUTC(biometricData.LogDate);
    const downloadDate = normalizeDeviceLogDateToUTC(biometricData.DownloadDate);

    if (!logDate || !downloadDate) {
      logger.error(
        'Invalid date format in biometric data',
        {
          logDateRaw: biometricData.LogDate,
          downloadDateRaw: biometricData.DownloadDate,
          normalizedLogDate: logDate,
          normalizedDownloadDate: downloadDate,
        }
      );
      throw new Error(`Invalid date format in biometric data. LogDate: ${biometricData.LogDate}, DownloadDate: ${biometricData.DownloadDate}`);
    }

    // Find user by employeeCode (matching employeeId in User model)
    let user = null;
    const rawEmployeeCode = biometricData.EmployeeCode;
    const normalizedEmployeeCode = normalizeEmployeeCode(rawEmployeeCode);
    if (rawEmployeeCode) {
      const employeeIdCandidates = [
        rawEmployeeCode,
        normalizedEmployeeCode,
      ].filter(Boolean);

      user = await User.findOne({
        employeeId: { $in: employeeIdCandidates },
        isDeleted: { $ne: true },
      }).select('_id employeeId');

      if (!user) {
        logger.warn('No user matched for employee code', {
          rawEmployeeCode,
          normalizedEmployeeCode,
        });
      }
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
      logDateIST: moment(logDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
      userId: user ? user._id : null,
      logId: biometricLog._id,
    });

    // Sync biometric log into attendance (if user mapping exists).
    // Use normalized device logDate, not createdAt.
    await syncBiometricToAttendance({
      user,
      logDate,
      direction: biometricData.Direction,
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
 * Normalizes employee code to match stored employeeId format.
 * Example: "SD116" -> "SD_116"
 * @param {string} employeeCode
 * @returns {string|null}
 */
function normalizeEmployeeCode(employeeCode) {
  if (!employeeCode || typeof employeeCode !== 'string') return null;

  const trimmed = employeeCode.trim().toUpperCase();
  if (trimmed.includes('_')) return trimmed;

  const match = trimmed.match(/^([A-Z]+)(\d+)$/);
  if (!match) return trimmed;

  return `${match[1]}_${match[2]}`;
}

/**
 * Validates biometric data structure
 * @param {object} data - Biometric data object
 * @returns {string|null} - Error message or null if valid
 */
function validateBiometricData(data) {
  // Core fields required for a valid biometric log.
  // Note: EmployeeCode is intentionally NOT in this list anymore,
  // because some device logs may not include it. In that case we
  // still want to store the raw log and just keep user association null.
  const requiredFields = [
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

  // EmployeeCode is optional: log a warning if it's missing, but don't fail validation.
  if (!data.EmployeeCode) {
    logger.warn &&
      logger.warn(
        {
          biometricDataKeys: Object.keys(data || {}),
        },
        'Biometric data has no EmployeeCode; log will be stored without user mapping'
      );
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
 * Device often sends IST wall-clock but timestamp is tagged as UTC.
 * Re-interpret that wall-clock as Asia/Kolkata and return true UTC Date.
 * @param {Date|string} dateValue
 * @returns {Date|null}
 */
function normalizeDeviceLogDateToUTC(dateValue) {
  if (!dateValue) return null;

  // 1) If the device already sends a full ISO timestamp with timezone (e.g. "...T..Z" or offset),
  //    trust it as UTC/offset and do NOT re-interpret as IST to avoid double shifting.
  if (
    typeof dateValue === 'string' &&
    /\dT.*(Z|[+\-]\d\d:?\d\d)$/.test(dateValue)
  ) {
    const mUtc = moment.utc(dateValue);
    return mUtc.isValid() ? mUtc.toDate() : null;
  }

  // 2) Otherwise, treat the value as an IST wall-clock time coming from the device.
  //    This keeps behaviour consistent across servers regardless of OS timezone.
  const asString =
    typeof dateValue === 'string'
      ? dateValue
      : moment(dateValue).format('YYYY-MM-DD HH:mm:ss');

  const istMoment = moment.tz(asString, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata');

  return istMoment.isValid() ? istMoment.utc().toDate() : null;
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

/**
 * Syncs biometric log into attendance record for the same day (IST).
 * @param {object} params
 * @param {object|null} params.user - Mongoose user doc (must have _id)
 * @param {Date} params.logDate - Log timestamp
 * @param {string} params.direction - IN/OUT
 */
async function syncBiometricToAttendance({ user, logDate, direction }) {
  try {
    if (!user || !user._id) {
      logger.warn('Skipping attendance sync: user not mapped for biometric log');
      return;
    }

    if (!logDate) {
      logger.warn('Skipping attendance sync: logDate missing');
      return;
    }

    const { attendanceDate, endOfDay } = getAttendanceDateRangeIST(logDate);

    let attendance = await Attendance.findOne({
      user: user._id,
      date: attendanceDate,
    });

    if (!attendance) {
      attendance = await Attendance.findOne({
        user: user._id,
        date: { $gte: attendanceDate, $lt: endOfDay },
      });
    }

    if (!attendance) {
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
    }

    const logTime = logDate instanceof Date ? logDate : new Date(logDate);

    // Direction ignored: always keep earliest log as check-in, latest log as check-out
    if (!attendance.biometricCheckIn || logTime < attendance.biometricCheckIn) {
      attendance.biometricCheckIn = logTime;
    }
    if (!attendance.biometricCheckOut || logTime > attendance.biometricCheckOut) {
      attendance.biometricCheckOut = logTime;
    }

    await attendance.save();
  } catch (error) {
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        userId: user?._id,
        logDate,
        direction,
      },
      'Failed to sync biometric log to attendance'
    );
  }
}

/**
 * Calculates IST day range for attendance storage.
 * @param {Date} logDate
 * @returns {{ attendanceDate: Date, endOfDay: Date }}
 */
function getAttendanceDateRangeIST(logDate) {
  const logMomentIST = moment(logDate).tz('Asia/Kolkata');
  const dayStartIST = logMomentIST.clone().startOf('day');
  const dayEndIST = dayStartIST.clone().add(1, 'day');
  return {
    attendanceDate: dayStartIST.utc().toDate(),
    endOfDay: dayEndIST.utc().toDate(),
  };
}

module.exports = {
  processBiometricWebhook,
};

