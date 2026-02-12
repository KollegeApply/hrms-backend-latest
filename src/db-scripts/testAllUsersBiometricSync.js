/**
 * Bulk biometric sync script for all active users.
 * Uses logDate with IST wall-clock normalization (same fix as testSD116).
 */

const mongoose = require('mongoose');
const path = require('path');
const moment = require('moment-timezone');

const BiometricLog = require('../models/biometricLogModel');
const User = require('../models/userModel');
const Attendance = require('../models/attendanceModel');

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

function convertEmployeeIdToEmployeeCode(employeeId) {
  if (!employeeId || typeof employeeId !== 'string') {
    return employeeId;
  }
  return employeeId.replace(/([A-Za-z]+)_(\d+)/, '$1$2');
}

/**
 * Device sends IST wall-clock values but payload may be tagged as UTC.
 * Re-interpret that wall-clock as Asia/Kolkata and return true UTC Date.
 */
function normalizeDeviceLogDateToUTC(logDate) {
  if (!logDate) {
    return null;
  }

  const wallClockIST = moment.utc(logDate).format('YYYY-MM-DD HH:mm:ss');
  return moment.tz(wallClockIST, 'YYYY-MM-DD HH:mm:ss', 'Asia/Kolkata').utc().toDate();
}

function getAttendanceWindowFromNormalizedLog(normalizedLogDate) {
  const normalizedLogDateIST = moment(normalizedLogDate).tz('Asia/Kolkata');
  const attendanceDateIST = normalizedLogDateIST.clone().startOf('day');

  const attendanceDate = attendanceDateIST.clone().utc().toDate();
  const endOfDay = attendanceDateIST.clone().add(1, 'day').utc().toDate();

  const istCalendarDate = attendanceDateIST.format('YYYY-MM-DD');
  const logDateQueryStart = moment.utc(istCalendarDate, 'YYYY-MM-DD').toDate();
  const logDateQueryEnd = moment.utc(istCalendarDate, 'YYYY-MM-DD').add(1, 'day').toDate();

  return {
    normalizedLogDateIST,
    attendanceDateIST,
    attendanceDate,
    endOfDay,
    logDateQueryStart,
    logDateQueryEnd,
  };
}

async function syncUserBiometric(user) {
  const employeeCode = convertEmployeeIdToEmployeeCode(user.employeeId);

  if (!employeeCode) {
    return {
      userId: user._id,
      employeeId: user.employeeId,
      status: 'skipped_no_employee_code',
    };
  }

  const latestLog = await BiometricLog.findOne({
    employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
  })
    .sort({ logDate: -1 })
    .select('_id employeeCode logDate createdAt')
    .lean();

  if (!latestLog) {
    return {
      userId: user._id,
      employeeId: user.employeeId,
      employeeCode,
      status: 'no_logs_found',
    };
  }

  const normalizedLatestLogDate = normalizeDeviceLogDateToUTC(latestLog.logDate);
  const window = getAttendanceWindowFromNormalizedLog(normalizedLatestLogDate);

  const biometricLogsForDay = await BiometricLog.find({
    employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') },
    logDate: {
      $gte: window.logDateQueryStart,
      $lt: window.logDateQueryEnd,
    },
  })
    .sort({ logDate: 1 })
    .select('logDate createdAt direction')
    .lean();

  if (biometricLogsForDay.length === 0) {
    return {
      userId: user._id,
      employeeId: user.employeeId,
      employeeCode,
      status: 'no_logs_for_latest_day',
      latestLogDate: latestLog.logDate,
      latestLogDateIST: moment(latestLog.logDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
    };
  }

  let attendance = await Attendance.findOne({
    user: user._id,
    date: window.attendanceDate,
  });

  if (!attendance) {
    attendance = await Attendance.findOne({
      user: user._id,
      date: {
        $gte: window.attendanceDate,
        $lt: window.endOfDay,
      },
    });
  }

  let wasCreated = false;
  if (!attendance) {
    attendance = new Attendance({
      user: user._id,
      date: window.attendanceDate,
    });
    wasCreated = true;
  }

  const firstLogTime = normalizeDeviceLogDateToUTC(biometricLogsForDay[0].logDate);
  const lastLogTime = normalizeDeviceLogDateToUTC(
    biometricLogsForDay[biometricLogsForDay.length - 1].logDate
  );

  if (!attendance.biometricCheckIn || firstLogTime < attendance.biometricCheckIn) {
    attendance.biometricCheckIn = firstLogTime;
  }

  if (!attendance.biometricCheckOut || lastLogTime > attendance.biometricCheckOut) {
    attendance.biometricCheckOut = lastLogTime;
  }

  await attendance.save();

  return {
    userId: user._id,
    employeeId: user.employeeId,
    employeeCode,
    status: wasCreated ? 'attendance_created_and_updated' : 'attendance_updated',
    latestLogDate: latestLog.logDate,
    latestLogDateIST: moment(latestLog.logDate).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
    normalizedLatestLogDateUTC: normalizedLatestLogDate,
    normalizedLatestLogDateIST: window.normalizedLogDateIST.format('YYYY-MM-DD HH:mm:ss'),
    attendanceDateUTC: window.attendanceDate,
    attendanceDateIST: window.attendanceDateIST.format('YYYY-MM-DD HH:mm:ss'),
    logsForDay: biometricLogsForDay.length,
    biometricCheckInUTC: attendance.biometricCheckIn,
    biometricCheckInIST: moment(attendance.biometricCheckIn).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
    biometricCheckOutUTC: attendance.biometricCheckOut,
    biometricCheckOutIST: moment(attendance.biometricCheckOut).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
  };
}

async function testAllUsersBiometricSync() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('MongoDB connected');

    const users = await User.find({
      isDeleted: { $ne: true },
      employeeId: { $exists: true, $ne: null },
    })
      .select('_id employeeId firstName lastName')
      .sort({ employeeId: 1 })
      .lean();

    console.log(`Total active users with employeeId: ${users.length}`);

    const results = [];
    for (let i = 0; i < users.length; i += 1) {
      const user = users[i];
      const result = await syncUserBiometric(user);
      results.push({
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        ...result,
      });

      if ((i + 1) % 25 === 0 || i === users.length - 1) {
        console.log(`Processed ${i + 1}/${users.length} users`);
      }
    }

    const summary = {
      totalUsersProcessed: results.length,
      attendanceUpdated: results.filter((r) => r.status === 'attendance_updated').length,
      attendanceCreatedAndUpdated: results.filter((r) => r.status === 'attendance_created_and_updated').length,
      noLogsFound: results.filter((r) => r.status === 'no_logs_found').length,
      noLogsForLatestDay: results.filter((r) => r.status === 'no_logs_for_latest_day').length,
      skippedNoEmployeeCode: results.filter((r) => r.status === 'skipped_no_employee_code').length,
    };

    console.log('\nSummary');
    console.log(summary);

    console.log('\nPer-user result');
    console.log(JSON.stringify(results, null, 2));

    await mongoose.connection.close();
    console.log('\nAll users biometric sync completed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testAllUsersBiometricSync();
