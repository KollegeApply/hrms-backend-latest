/**
 * Test script specifically for SD_116 to debug attendance sync
 */

const mongoose = require('mongoose');
const path = require('path');
const moment = require('moment-timezone');

const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const Attendance = require('../models/attendanceModel');

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

/**
 * Device sends IST wall-clock values but payload may be tagged as UTC.
 * This function re-interprets the wall-clock as Asia/Kolkata and returns true UTC Date.
 */
function normalizeDeviceLogDateToUTC(logDate) {
  if (!logDate) {
    return null;
  }

  const wallClockIST = moment.utc(logDate).format('YYYY-MM-DD HH:mm:ss');
  return moment.tz(wallClockIST, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
}

async function testSD116Sync() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('MongoDB connected\n');

    const employeeCode = 'SD116';
    const employeeId = 'SD_116';

    console.log('Testing for:');
    console.log(`  employeeCode: ${employeeCode}`);
    console.log(`  employeeId: ${employeeId}\n`);

    // Step 1: Find user
    const user = await User.findOne({
      employeeId,
      isDeleted: { $ne: true },
    }).select('_id employeeId firstName lastName');

    if (!user) {
      console.log('User NOT found');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('Step 1: User found');
    console.log({
      _id: user._id,
      employeeId: user.employeeId,
      name: `${user.firstName} ${user.lastName}`,
    });
    console.log('');

    // Step 2: Get latest biometric log by logDate
    const latestLog = await BiometricLog.findOne({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
    })
      .sort({ logDate: -1 })
      .select('logDate createdAt employeeCode');

    if (!latestLog) {
      console.log('No biometric logs found');
      await mongoose.connection.close();
      process.exit(0);
    }

    const normalizedLatestLogDate = normalizeDeviceLogDateToUTC(latestLog.logDate);

    console.log('Step 2: Latest biometric log found');
    console.log({
      _id: latestLog._id,
      employeeCode: latestLog.employeeCode,
      logDate: latestLog.logDate,
      createdAt: latestLog.createdAt,
      logDateIST: moment(latestLog.logDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
      normalizedLogDateUTC: normalizedLatestLogDate,
      normalizedLogDateIST: moment(normalizedLatestLogDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
      createdAtIST: latestLog.createdAt
        ? moment(latestLog.createdAt).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
        : 'N/A',
      note: 'Using normalized logDate for date calculation (IST time)',
    });
    console.log('');

    // Step 3: Calculate date range from normalized logDate (IST day)
    const normalizedLogDateIST = moment(normalizedLatestLogDate).tz('Asia/Kolkata');
    const attendanceDateIST = normalizedLogDateIST.clone().startOf('day');

    // Attendance date is stored as UTC instant corresponding to IST midnight
    const attendanceDate = attendanceDateIST.clone().utc().toDate();
    const endOfDay = attendanceDateIST.clone().add(1, 'day').utc().toDate();

    // For querying raw logDate values as stored in DB (UTC-tagged wall-clock)
    const istCalendarDate = attendanceDateIST.format('YYYY-MM-DD');
    const logDateQueryStart = moment.utc(istCalendarDate, 'YYYY-MM-DD').toDate();
    const logDateQueryEnd = moment.utc(istCalendarDate, 'YYYY-MM-DD').add(1, 'day').toDate();

    console.log('Step 3: Date calculation (using normalized logDate)');
    console.log({
      originalLogDate: latestLog.logDate,
      normalizedLogDateUTC: normalizedLatestLogDate,
      normalizedLogDateIST: normalizedLogDateIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDateIST: attendanceDateIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDate,
      endOfDay,
      logDateQueryStart,
      logDateQueryEnd,
    });
    console.log('');

    // Step 4: Find attendance record
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
      console.log('Step 4: No attendance record found, creating new one...');
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
      await attendance.save();
      console.log('Created new attendance record');
    } else {
      console.log('Step 4: Attendance record found');
      console.log({
        _id: attendance._id,
        date: attendance.date,
        current_biometricCheckIn: attendance.biometricCheckIn,
        current_biometricCheckOut: attendance.biometricCheckOut,
      });
    }
    console.log('');

    // Step 5: Query biometric logs for the day (using logDate)
    const biometricLogsForDay = await BiometricLog.find({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
      logDate: {
        $gte: logDateQueryStart,
        $lt: logDateQueryEnd,
      },
    })
      .sort({ logDate: 1 })
      .select('logDate createdAt direction employeeCode')
      .lean();

    console.log('Step 5: Biometric logs query');
    console.log({
      query: {
        employeeCode,
        logDate: {
          $gte: logDateQueryStart,
          $lt: logDateQueryEnd,
        },
      },
      totalLogs: biometricLogsForDay.length,
      logs: biometricLogsForDay.map((log) => {
        const normalizedLogDate = normalizeDeviceLogDateToUTC(log.logDate);
        return {
          logDate: log.logDate,
          logDateIST: moment(log.logDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
          normalizedLogDateUTC: normalizedLogDate,
          normalizedLogDateIST: moment(normalizedLogDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
          createdAt: log.createdAt,
          createdAtIST: moment(log.createdAt).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
          direction: log.direction,
        };
      }),
    });
    console.log('');

    if (biometricLogsForDay.length === 0) {
      console.log('No logs found for the date range');

      const allLogs = await BiometricLog.find({
        employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
      })
        .sort({ logDate: -1 })
        .limit(5)
        .select('logDate createdAt employeeCode')
        .lean();

      console.log('\nAll logs for this employeeCode:');
      allLogs.forEach((log, i) => {
        const createdAtIST = moment(log.createdAt).tz('Asia/Kolkata');
        const logDateIST = moment(log.logDate).tz('Asia/Kolkata');
        const normalizedLogDate = normalizeDeviceLogDateToUTC(log.logDate);

        console.log(`  ${i + 1}. createdAt: ${createdAtIST.format('YYYY-MM-DD HH:mm:ss')} (${log.createdAt})`);
        console.log(`     logDate: ${logDateIST.format('YYYY-MM-DD HH:mm:ss')} (${log.logDate})`);
        console.log(
          `     normalizedLogDateIST: ${moment(normalizedLogDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')} (${normalizedLogDate})`
        );
      });

      await mongoose.connection.close();
      process.exit(0);
    }

    // Step 6: Update attendance
    console.log('Step 6: Updating attendance...');

    if (biometricLogsForDay.length > 0 && !attendance.biometricCheckIn) {
      const firstLogTime = normalizeDeviceLogDateToUTC(biometricLogsForDay[0].logDate);
      attendance.biometricCheckIn = firstLogTime;
      console.log(`  Setting biometricCheckIn: ${firstLogTime}`);
    } else if (attendance.biometricCheckIn) {
      console.log(`  biometricCheckIn already set: ${attendance.biometricCheckIn}`);
    }

    if (biometricLogsForDay.length > 0) {
      const lastLogTime = normalizeDeviceLogDateToUTC(
        biometricLogsForDay[biometricLogsForDay.length - 1].logDate
      );
      const previousCheckOut = attendance.biometricCheckOut;
      attendance.biometricCheckOut = lastLogTime;
      console.log(`  Updating biometricCheckOut: ${previousCheckOut || 'null'} -> ${lastLogTime}`);
    }

    await attendance.save();
    console.log('');

    // Step 7: Verify
    const finalAttendance = await Attendance.findById(attendance._id);
    console.log('Step 7: Final attendance record');
    console.log({
      _id: finalAttendance._id,
      date: finalAttendance.date,
      biometricCheckIn: finalAttendance.biometricCheckIn,
      biometricCheckOut: finalAttendance.biometricCheckOut,
      biometricCheckInIST: finalAttendance.biometricCheckIn
        ? moment(finalAttendance.biometricCheckIn).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
        : null,
      biometricCheckOutIST: finalAttendance.biometricCheckOut
        ? moment(finalAttendance.biometricCheckOut).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
        : null,
    });

    await mongoose.connection.close();
    console.log('\nTest completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testSD116Sync();
