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
        const allLogs = await BiometricLog.find({
          employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
        }).sort({ logDate: 1 }).select('logDate').lean();

        // Group logs by date
        const logsByDate = {};
        allLogs.forEach(log => {
          const logDateIST = moment(log.logDate).tz('Asia/Kolkata').startOf('day');
          const dateKey = logDateIST.format('YYYY-MM-DD');
          
          if (!logsByDate[dateKey]) {
            logsByDate[dateKey] = [];
          }
          logsByDate[dateKey].push(log.logDate);
        });

        console.log(`   📅 Found logs for ${Object.keys(logsByDate).length} date(s)`);

        // Sync each date
        for (const [dateKey, logDates] of Object.entries(logsByDate)) {
          const logDateIST = moment(dateKey).tz('Asia/Kolkata').startOf('day');
          const attendanceDate = logDateIST.toDate();
          const endOfDay = moment(logDateIST).add(1, 'day').toDate();

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

          // Set biometricCheckIn (first log of the day)
          if (logDates.length > 0 && !attendance.biometricCheckIn) {
            const firstLogTime = new Date(Math.min(...logDates.map(d => new Date(d).getTime())));
            attendance.biometricCheckIn = firstLogTime;
            console.log(`      ✅ Set biometricCheckIn: ${firstLogTime}`);
          }

          // Set biometricCheckOut (last log of the day)
          if (logDates.length > 0) {
            const lastLogTime = new Date(Math.max(...logDates.map(d => new Date(d).getTime())));
            attendance.biometricCheckOut = lastLogTime;
            console.log(`      ✅ Set biometricCheckOut: ${lastLogTime}`);
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

