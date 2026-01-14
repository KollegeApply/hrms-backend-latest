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
        // Use createdAt (when log was saved) for date calculation
        const allLogs = await BiometricLog.find({
          employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
        })
          .sort({ createdAt: 1 })
          .select('logDate createdAt')
          .lean();

        // Group logs by date (based on createdAt in IST)
        const logsByDate = {};
        allLogs.forEach(log => {
          const baseDate = log.createdAt || log.logDate;
          const createdAtIST = moment(baseDate).tz('Asia/Kolkata').startOf('day');
          const dateKey = createdAtIST.format('YYYY-MM-DD');
          
          if (!logsByDate[dateKey]) {
            logsByDate[dateKey] = [];
          }
          logsByDate[dateKey].push({
            logDate: log.logDate,
            createdAt: log.createdAt,
          });
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

          // Set biometricCheckIn (first log of the day) using createdAt (fallback to logDate)
          if (logDates.length > 0 && !attendance.biometricCheckIn) {
            const firstLog = logDates.reduce((min, curr) => {
              const currTime = new Date(curr.createdAt || curr.logDate).getTime();
              const minTime = new Date(min.createdAt || min.logDate).getTime();
              return currTime < minTime ? curr : min;
            }, logDates[0]);

            const firstLogTime = firstLog.createdAt || firstLog.logDate;
            attendance.biometricCheckIn = firstLogTime;
            console.log(`      ✅ Set biometricCheckIn (createdAt): ${firstLogTime}`);
          }

          // Set biometricCheckOut (last log of the day) using createdAt (fallback to logDate)
          if (logDates.length > 0) {
            const lastLog = logDates.reduce((max, curr) => {
              const currTime = new Date(curr.createdAt || curr.logDate).getTime();
              const maxTime = new Date(max.createdAt || max.logDate).getTime();
              return currTime > maxTime ? curr : max;
            }, logDates[0]);

            const lastLogTime = lastLog.createdAt || lastLog.logDate;
            attendance.biometricCheckOut = lastLogTime;
            console.log(`      ✅ Set biometricCheckOut (createdAt): ${lastLogTime}`);
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

