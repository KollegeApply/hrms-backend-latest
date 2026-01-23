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
    // Convert employeeCode format (SD116) to employeeId format (SD_116)
    // Handle both EmployeeCode (capital E) and employeeCode (lowercase e) from payload
    let user = null;
    const employeeCode = biometricData.EmployeeCode || biometricData.employeeCode;
    
    if (employeeCode) {
      const convertedEmployeeId = convertEmployeeCodeToEmployeeId(employeeCode);
      logger.info('Converting employeeCode to employeeId format', {
        originalEmployeeCode: employeeCode,
        convertedEmployeeId: convertedEmployeeId,
        payloadKeys: Object.keys(biometricData),
      });

      user = await User.findOne({
        employeeId: convertedEmployeeId,
        isDeleted: { $ne: true },
      }).select('_id employeeId');
      
      if (!user) {
        logger.warn('User not found for employeeCode', {
          employeeCode: employeeCode,
          convertedEmployeeId: convertedEmployeeId,
        });
      } else {
        logger.info('User found successfully', {
          userId: user._id,
          employeeId: user.employeeId,
          employeeCode: employeeCode,
        });
      }
    } else {
      logger.warn('No employeeCode found in biometric data', {
        payloadKeys: Object.keys(biometricData),
      });
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

    // Sync biometric data with attendance record
    // Use employeeCode to find biometric logs, not user field (which is always null)
    const employeeCodeForSync = biometricData.EmployeeCode || biometricData.employeeCode;
    
    // Use createdAt (when log was saved) for date calculation, not logDate
    if (user && biometricLog.createdAt && employeeCodeForSync) {
      logger.info('Calling syncBiometricWithAttendance', {
        userId: user._id,
        employeeId: user.employeeId,
        employeeCode: employeeCodeForSync,
        createdAt: biometricLog.createdAt,
      });
      await syncBiometricWithAttendance(user, employeeCodeForSync, biometricLog.createdAt);
    } else {
      logger.warn('Skipping attendance sync - missing user, logDate, or employeeCode', {
        hasUser: !!user,
        hasLogDate: !!logDate,
        hasEmployeeCode: !!employeeCodeForSync,
        userId: user?._id,
        employeeCode: employeeCodeForSync,
        payloadKeys: Object.keys(biometricData),
      });
    }

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

/**
 * Converts employeeCode format (SD116, KAPP123) to employeeId format (SD_116, KAPP_123)
 * Adds underscore before the first sequence of digits
 * @param {string} employeeCode - Employee code from biometric logs (e.g., "SD116", "KAPP123")
 * @returns {string} - Converted employee ID format (e.g., "SD_116", "KAPP_123")
 */
function convertEmployeeCodeToEmployeeId(employeeCode) {
  if (!employeeCode || typeof employeeCode !== 'string') {
    return employeeCode;
  }

  // Find the first occurrence of digits and insert underscore before them
  // Match pattern: letters followed by digits
  // Example: "SD116" -> "SD_116", "KAPP123" -> "KAPP_123"
  return employeeCode.replace(/([A-Za-z]+)(\d+)/, '$1_$2');
}

/**
 * Syncs biometric log with attendance record
 * Sets biometricCheckIn for first check-in of the day
 * Updates biometricCheckOut for every subsequent log (always keeps the latest)
 * @param {object} user - User object with _id
 * @param {string} employeeCode - Employee code from biometric log (e.g., "SD116")
 * @param {Date} createdAt - createdAt timestamp of the biometric log (when it was saved to DB)
 */
async function syncBiometricWithAttendance(user, employeeCode, createdAt) {
  if (!user || !user._id) {
    logger.warn('No user found, skipping attendance sync', {
      user: user,
      hasId: user?._id ? true : false,
    });
    return;
  }

  try {
    // Calculate attendance date based on createdAt (IST time)
    // Attendance date format: IST start of day converted to UTC
    // Example: For 3rd Jan 2026, attendance date = 2026-01-02T18:30:00.000Z (which is 2026-01-03 00:00:00 IST)
    const createdAtIST = moment(createdAt).tz('Asia/Kolkata');
    const attendanceDateIST = createdAtIST.clone().startOf('day');
    
    // Convert IST start of day to UTC (this matches attendance record date format)
    // IST is UTC+5:30, so 00:00 IST = 18:30 UTC (previous day)
    const attendanceDate = attendanceDateIST.utc().toDate();
    
    // End of day in IST, converted to UTC
    const endOfDayIST = attendanceDateIST.clone().add(1, 'day');
    const endOfDay = endOfDayIST.utc().toDate();

    logger.info('Syncing biometric with attendance - Date calculation', {
      userId: user._id,
      employeeCode: employeeCode,
      originalCreatedAt: createdAt,
      createdAtIST: createdAtIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDateIST: attendanceDateIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDate: attendanceDate,
      endOfDay: endOfDay,
      attendanceDateIST_UTC: attendanceDateIST.utc().format('YYYY-MM-DD HH:mm:ss'),
    });

    // Find or get attendance record for this user and date
    // Attendance records use IST start of day converted to UTC
    let attendance = await Attendance.findOne({
      user: user._id,
      date: attendanceDate,
    });

    // If not found with exact match, try range query (handles timezone differences)
    if (!attendance) {
      attendance = await Attendance.findOne({
        user: user._id,
        date: {
          $gte: attendanceDate,
          $lt: endOfDay,
        },
      });
    }

    logger.debug('Attendance record lookup', {
      userId: user._id,
      attendanceDate: attendanceDate,
      found: !!attendance,
      attendanceId: attendance?._id,
    });

    if (!attendance) {
      // If no attendance record exists, create one (minimal record)
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
      await attendance.save();
      logger.info('Created new attendance record for biometric sync', {
        userId: user._id,
        attendanceId: attendance._id,
        date: attendanceDate,
      });
    }

    // Get all biometric logs for this employeeCode on this date, ordered by createdAt
    // Use employeeCode to query, not user field (which is always null in biometric logs)
    // Query logs for the same date (IST date, not UTC) using createdAt
    // Use attendanceDate (IST start of day converted to UTC) and endOfDay as UTC bounds
    const createdAtStartUTC = attendanceDate;
    const createdAtEndUTC = endOfDay;
    
    const biometricLogsForDay = await BiometricLog.find({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
      createdAt: {
        $gte: createdAtStartUTC,
        $lt: createdAtEndUTC,
      },
    })
      .sort({ createdAt: 1 })
      .select('logDate createdAt direction employeeCode')
      .lean();

    logger.info('Biometric logs query result', {
      userId: user._id,
      employeeCode: employeeCode,
      attendanceDate: attendanceDate,
      attendanceDateIST: attendanceDateIST.format('YYYY-MM-DD'),
      dateRange: {
        startUTC: createdAtStartUTC,
        endUTC: createdAtEndUTC,
      },
      totalLogs: biometricLogsForDay.length,
      logs: biometricLogsForDay.map(log => ({
        logDate: log.logDate,
        createdAt: log.createdAt,
        createdAtIST: moment(log.createdAt).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
        direction: log.direction,
        employeeCode: log.employeeCode,
      })),
    });

    // If no logs found, try to find any logs for this employeeCode to debug
    if (biometricLogsForDay.length === 0) {
      const anyLogs = await BiometricLog.find({
        employeeCode: employeeCode,
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('logDate createdAt employeeCode')
        .lean();
      
      logger.warn('No biometric logs found for the date range, but found logs for employeeCode', {
        employeeCode: employeeCode,
        dateRange: {
          startUTC: createdAtStartUTC,
          endUTC: createdAtEndUTC,
        },
        recentLogs: anyLogs.map(log => ({
          logDate: log.logDate,
          createdAt: log.createdAt,
          employeeCode: log.employeeCode,
        })),
      });
    }

    // If this is the first log of the day and biometricCheckIn is not set, set it
    if (biometricLogsForDay.length > 0 && !attendance.biometricCheckIn) {
      // Get the first log's time from createdAt
      const firstLogTime = biometricLogsForDay[0].createdAt;
      attendance.biometricCheckIn = firstLogTime;
      logger.info('Setting biometricCheckIn (first check-in of the day)', {
        userId: user._id,
        employeeCode: employeeCode,
        date: attendanceDate,
        checkInTime: firstLogTime,
        attendanceId: attendance._id,
        currentBiometricCheckIn: attendance.biometricCheckIn,
      });
    } else if (biometricLogsForDay.length > 0 && attendance.biometricCheckIn) {
      logger.info('biometricCheckIn already set, skipping', {
        userId: user._id,
        employeeCode: employeeCode,
        existingBiometricCheckIn: attendance.biometricCheckIn,
        firstLogTime: biometricLogsForDay[0].createdAt,
      });
    }

    // Always update biometricCheckOut with the latest log time of the day (using createdAt)
    // This ensures the last checkout is always stored (removes old, sets new)
    if (biometricLogsForDay.length > 0) {
      const lastLogTime = biometricLogsForDay[biometricLogsForDay.length - 1].createdAt;
      const previousCheckOut = attendance.biometricCheckOut;
      attendance.biometricCheckOut = lastLogTime;
      logger.info('Updating biometricCheckOut (latest log of the day)', {
        userId: user._id,
        employeeCode: employeeCode,
        date: attendanceDate,
        checkOutTime: lastLogTime,
        previousCheckOut: previousCheckOut,
        totalLogs: biometricLogsForDay.length,
        attendanceId: attendance._id,
      });
    } else {
      logger.warn('No biometric logs found for the day, cannot update biometricCheckIn/CheckOut', {
        userId: user._id,
        employeeCode: employeeCode,
        date: attendanceDate,
      });
    }

    // Save the attendance record
    const savedAttendance = await attendance.save();
    
    logger.info('✅ Biometric data synced with attendance successfully', {
      userId: user._id,
      employeeCode: employeeCode,
      date: attendanceDate,
      attendanceId: savedAttendance._id,
      biometricCheckIn: savedAttendance.biometricCheckIn,
      biometricCheckOut: savedAttendance.biometricCheckOut,
      totalBiometricLogs: biometricLogsForDay.length,
      attendanceRecord: {
        _id: savedAttendance._id,
        user: savedAttendance.user,
        date: savedAttendance.date,
        biometricCheckIn: savedAttendance.biometricCheckIn,
        biometricCheckOut: savedAttendance.biometricCheckOut,
      },
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        userId: user?._id,
        createdAt: createdAt,
      },
      'Error syncing biometric data with attendance'
    );
    // Don't throw error - we still want to save the biometric log even if attendance sync fails
  }
}

module.exports = {
  processBiometricWebhook,
};

