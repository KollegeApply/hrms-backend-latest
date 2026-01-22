/**
 * Script to sync existing biometric logs with attendance records
 * This will update attendance records with biometricCheckIn and biometricCheckOut
 */

const mongoose = require('mongoose');
const path = require('path');

// Try different env file locations
const envPaths = [
  path.resolve(__dirname, '../../.env.development'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    break;
  } catch (error) {
    // Continue to next path
  }
}

const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const Attendance = require('../models/attendanceModel');
const moment = require('moment-timezone');

/**
 * Converts employeeCode format (SD116) to employeeId format (SD_116)
 */
function convertEmployeeCodeToEmployeeId(employeeCode) {
  if (!employeeCode || typeof employeeCode !== 'string') {
    return employeeCode;
  }
  return employeeCode.replace(/([A-Za-z]+)(\d+)/, '$1_$2');
}

async function syncExistingBiometricLogs() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected\n');

    // Get all unique employeeCodes from biometric logs
    const employeeCodes = await BiometricLog.distinct('employeeCode', {
      employeeCode: { $exists: true, $ne: null }
    });

    console.log(`📋 Found ${employeeCodes.length} unique employeeCodes\n`);

    let processedCount = 0;
    let syncedCount = 0;
    let errorCount = 0;

    for (const employeeCode of employeeCodes) {
      try {
        processedCount++;
        console.log(`\n[${processedCount}/${employeeCodes.length}] Processing: ${employeeCode}`);

        // Convert employeeCode to employeeId
        const convertedEmployeeId = convertEmployeeCodeToEmployeeId(employeeCode);
        console.log(`   Converted: ${employeeCode} → ${convertedEmployeeId}`);

        // Find user
        const user = await User.findOne({
          employeeId: convertedEmployeeId,
          isDeleted: { $ne: true },
        }).select('_id employeeId');

        if (!user) {
          console.log(`   ⚠️  User not found, skipping...`);
          continue;
        }

        console.log(`   ✅ User found: ${user.employeeId}`);

        // Get all biometric logs for this employeeCode, grouped by date
        // Use logDate (ignoring timezone) for date calculation
        const allLogs = await BiometricLog.find({
          employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
        })
          .sort({ logDate: 1 })
          .select('logDate createdAt')
          .lean();

        // Group logs by date (based on logDate, ignoring timezone)
        const logsByDate = {};
        allLogs.forEach(log => {
          // Extract date part directly from logDate string, ignoring timezone
          let logDateStr = '';
          if (log.logDate instanceof Date) {
            logDateStr = log.logDate.toISOString();
          } else if (typeof log.logDate === 'string') {
            logDateStr = log.logDate;
          } else {
            logDateStr = log.logDate.toString();
          }
          
          // Extract YYYY-MM-DD from ISO string (first 10 characters before 'T')
          const dateMatch = logDateStr.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const dateKey = dateMatch[1];
            
            if (!logsByDate[dateKey]) {
              logsByDate[dateKey] = [];
            }
            logsByDate[dateKey].push({
              logDate: log.logDate,
              createdAt: log.createdAt,
            });
          }
        });

        console.log(`   📅 Found logs for ${Object.keys(logsByDate).length} date(s)`);

        // Sync each date (dateKey is IST date string based on createdAt)
        for (const [dateKey, logDates] of Object.entries(logsByDate)) {
          // attendanceDate should be IST start-of-day converted to UTC
          const attendanceDateIST = moment(dateKey).tz('Asia/Kolkata').startOf('day');
          const attendanceDate = attendanceDateIST.utc().toDate();
          const endOfDayIST = attendanceDateIST.clone().add(1, 'day');
          const endOfDay = endOfDayIST.utc().toDate();

          // Find or create attendance record
          let attendance = await Attendance.findOne({
            user: user._id,
            date: attendanceDate,
          });

          if (!attendance) {
            attendance = await Attendance.findOne({
              user: user._id,
              date: {
                $gte: attendanceDate,
                $lt: endOfDay,
              },
            });
          }

          if (!attendance) {
            attendance = new Attendance({
              user: user._id,
              date: attendanceDate,
            });
            await attendance.save();
            console.log(`      ✅ Created attendance for ${dateKey}`);
          }

          // Set biometricCheckIn (first log of the day) using logDate (ignoring timezone)
          if (logDates.length > 0 && !attendance.biometricCheckIn) {
            // Sort by logDate time (ignoring timezone)
            const sortedLogs = logDates.sort((a, b) => {
              let aStr = '';
              let bStr = '';
              if (a.logDate instanceof Date) {
                aStr = a.logDate.toISOString();
              } else if (typeof a.logDate === 'string') {
                aStr = a.logDate;
              } else {
                aStr = a.logDate.toString();
              }
              if (b.logDate instanceof Date) {
                bStr = b.logDate.toISOString();
              } else if (typeof b.logDate === 'string') {
                bStr = b.logDate;
              } else {
                bStr = b.logDate.toString();
              }
              return aStr.localeCompare(bStr);
            });

            const firstLog = sortedLogs[0];
            let firstLogDateStr = '';
            if (firstLog.logDate instanceof Date) {
              firstLogDateStr = firstLog.logDate.toISOString();
            } else if (typeof firstLog.logDate === 'string') {
              firstLogDateStr = firstLog.logDate;
            } else {
              firstLogDateStr = firstLog.logDate.toString();
            }
            
            const dateTimeMatch = firstLogDateStr.match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
            if (dateTimeMatch) {
              const [, datePart, hour, minute, second, millisecond] = dateTimeMatch;
              const [year, month, date] = datePart.split('-').map(Number);
              const firstLogTime = moment({
                year: year,
                month: month - 1,
                date: date,
                hour: parseInt(hour),
                minute: parseInt(minute),
                second: parseInt(second),
                millisecond: millisecond ? parseInt(millisecond.padEnd(3, '0')) : 0
              }).utc().toDate();
              attendance.biometricCheckIn = firstLogTime;
              console.log(`      ✅ Set biometricCheckIn (logDate): ${firstLogTime}`);
            }
          }

          // Set biometricCheckOut (last log of the day) using logDate (ignoring timezone)
          if (logDates.length > 0) {
            // Sort by logDate time (ignoring timezone)
            const sortedLogs = logDates.sort((a, b) => {
              let aStr = '';
              let bStr = '';
              if (a.logDate instanceof Date) {
                aStr = a.logDate.toISOString();
              } else if (typeof a.logDate === 'string') {
                aStr = a.logDate;
              } else {
                aStr = a.logDate.toString();
              }
              if (b.logDate instanceof Date) {
                bStr = b.logDate.toISOString();
              } else if (typeof b.logDate === 'string') {
                bStr = b.logDate;
              } else {
                bStr = b.logDate.toString();
              }
              return aStr.localeCompare(bStr);
            });

            const lastLog = sortedLogs[sortedLogs.length - 1];
            let lastLogDateStr = '';
            if (lastLog.logDate instanceof Date) {
              lastLogDateStr = lastLog.logDate.toISOString();
            } else if (typeof lastLog.logDate === 'string') {
              lastLogDateStr = lastLog.logDate;
            } else {
              lastLogDateStr = lastLog.logDate.toString();
            }
            
            const dateTimeMatch = lastLogDateStr.match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
            if (dateTimeMatch) {
              const [, datePart, hour, minute, second, millisecond] = dateTimeMatch;
              const [year, month, date] = datePart.split('-').map(Number);
              const lastLogTime = moment({
                year: year,
                month: month - 1,
                date: date,
                hour: parseInt(hour),
                minute: parseInt(minute),
                second: parseInt(second),
                millisecond: millisecond ? parseInt(millisecond.padEnd(3, '0')) : 0
              }).utc().toDate();
              attendance.biometricCheckOut = lastLogTime;
              console.log(`      ✅ Set biometricCheckOut (logDate): ${lastLogTime}`);
            }
          }

          await attendance.save();
          syncedCount++;
        }

      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error processing ${employeeCode}:`, error.message);
      }
    }

    console.log('\n\n✅ Sync completed!');
    console.log({
      totalEmployeeCodes: employeeCodes.length,
      processed: processedCount,
      synced: syncedCount,
      errors: errorCount,
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the sync
syncExistingBiometricLogs();

