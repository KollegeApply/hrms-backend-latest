/**
 * Test script specifically for SD_116 to debug attendance sync
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

async function testSD116Sync() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('No MongoDB URI found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected\n');

    const employeeCode = 'SD116';
    const employeeId = 'SD_116';

    console.log('🔍 Testing for:');
    console.log(`   employeeCode: ${employeeCode}`);
    console.log(`   employeeId: ${employeeId}\n`);

    // Step 1: Find user
    const user = await User.findOne({
      employeeId: employeeId,
      isDeleted: { $ne: true },
    }).select('_id employeeId firstName lastName');

    if (!user) {
      console.log('❌ User NOT found!');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('✅ Step 1: User found');
    console.log({
      _id: user._id,
      employeeId: user.employeeId,
      name: `${user.firstName} ${user.lastName}`,
    });
    console.log('');

    // Step 2: Get latest biometric log (by logDate - ignoring timezone)
    const latestLog = await BiometricLog.findOne({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
    }).sort({ logDate: -1 }).select('logDate createdAt employeeCode');

    if (!latestLog) {
      console.log('❌ No biometric logs found!');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Parse logDate ignoring timezone - extract date/time as-is
    // e.g., 2026-01-21T15:02:10.000+00:00 -> treat as 21st Jan at 15:02
    // Extract date parts directly from ISO string to avoid timezone conversion
    let logDateStr = '';
    if (latestLog.logDate instanceof Date) {
      logDateStr = latestLog.logDate.toISOString();
    } else if (typeof latestLog.logDate === 'string') {
      logDateStr = latestLog.logDate;
    } else {
      logDateStr = latestLog.logDate.toString();
    }
    
    // Extract YYYY-MM-DD and HH:mm:ss from the string (ignoring timezone)
    const dateTimeMatch = logDateStr.match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!dateTimeMatch) {
      throw new Error(`Invalid logDate format: ${latestLog.logDate}`);
    }
    
    const [, datePart, hour, minute, second] = dateTimeMatch;
    const [year, month, date] = datePart.split('-').map(Number);
    
    // Create moment object with extracted values (no timezone conversion)
    const logDateIgnoringTZ = moment({
      year: year,
      month: month - 1, // moment months are 0-indexed
      date: date,
      hour: parseInt(hour),
      minute: parseInt(minute),
      second: parseInt(second)
    });

    console.log('✅ Step 2: Latest biometric log found');
    console.log({
      _id: latestLog._id,
      employeeCode: latestLog.employeeCode,
      logDate: latestLog.logDate,
      logDateParsed: logDateIgnoringTZ.format('YYYY-MM-DD HH:mm:ss'),
      note: 'Using logDate for date calculation (ignoring timezone)',
    });
    console.log('');

    // Step 3: Calculate date range based on logDate (ignoring timezone)
    // Extract date part and treat as IST start of day, then convert to UTC
    const attendanceDateIST = logDateIgnoringTZ.clone().startOf('day');
    
    // Convert IST start of day to UTC (this matches attendance record date format)
    // IST is UTC+5:30, so 00:00 IST = 18:30 UTC (previous day)
    const attendanceDate = attendanceDateIST.utc().toDate();
    
    // End of day in IST, converted to UTC
    const endOfDayIST = attendanceDateIST.clone().add(1, 'day');
    const endOfDay = endOfDayIST.utc().toDate();

    console.log('✅ Step 3: Date calculation (using logDate, ignoring timezone)');
    console.log({
      originalLogDate: latestLog.logDate,
      logDateParsed: logDateIgnoringTZ.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDateIST: attendanceDateIST.format('YYYY-MM-DD HH:mm:ss'),
      attendanceDate: attendanceDate,
      endOfDay: endOfDay,
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
      console.log('⚠️  Step 4: No attendance record found, creating new one...');
      attendance = new Attendance({
        user: user._id,
        date: attendanceDate,
      });
      await attendance.save();
      console.log('✅ Created new attendance record');
    } else {
      console.log('✅ Step 4: Attendance record found');
      console.log({
        _id: attendance._id,
        date: attendance.date,
        current_biometricCheckIn: attendance.biometricCheckIn,
        current_biometricCheckOut: attendance.biometricCheckOut,
      });
    }
    console.log('');

    // Step 5: Query biometric logs for the day (using logDate, ignoring timezone)
    // We need to query by comparing logDate ignoring timezone
    // Get all logs and filter by date part
    const allLogsForEmployee = await BiometricLog.find({
      employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
    })
      .sort({ logDate: 1 })
      .select('logDate createdAt direction employeeCode')
      .lean();

    // Filter logs by date (ignoring timezone)
    // Extract date part directly from logDate (YYYY-MM-DD) to avoid timezone issues
    const targetDateStr = logDateIgnoringTZ.format('YYYY-MM-DD');
    const biometricLogsForDay = allLogsForEmployee.filter(log => {
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
      if (!dateMatch) {
        return false;
      }
      const logDateOnly = dateMatch[1];
      return logDateOnly === targetDateStr;
    });

    console.log('✅ Step 5: Biometric logs query');
    console.log({
      query: {
        employeeCode: employeeCode,
        targetDate: targetDateStr,
        note: 'Filtering by logDate date part (ignoring timezone)',
      },
      totalLogs: biometricLogsForDay.length,
      logs: biometricLogsForDay.map(log => {
        // Extract date/time directly from ISO string (ignoring timezone)
        let logDateStr = '';
        if (log.logDate instanceof Date) {
          logDateStr = log.logDate.toISOString();
        } else if (typeof log.logDate === 'string') {
          logDateStr = log.logDate;
        } else {
          logDateStr = log.logDate.toString();
        }
        
        const dateTimeMatch = logDateStr.match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (dateTimeMatch) {
          const [, datePart, hour, minute, second] = dateTimeMatch;
          const [year, month, date] = datePart.split('-').map(Number);
          const logDateParsed = moment({
            year: year,
            month: month - 1,
            date: date,
            hour: parseInt(hour),
            minute: parseInt(minute),
            second: parseInt(second)
          });
          return {
            logDate: log.logDate,
            logDateParsed: logDateParsed.format('YYYY-MM-DD HH:mm:ss'),
            direction: log.direction,
          };
        }
        return {
          logDate: log.logDate,
          logDateParsed: 'Invalid format',
          direction: log.direction,
        };
      }),
    });
    console.log('');

    if (biometricLogsForDay.length === 0) {
      console.log('❌ No logs found for the date range!');
      
      // Check what logs exist
      const allLogs = await BiometricLog.find({
        employeeCode: { $regex: new RegExp(`^${employeeCode}$`, 'i') }
      }).sort({ logDate: -1 }).limit(5).select('logDate createdAt employeeCode').lean();
      
      console.log('\n📋 All logs for this employeeCode:');
      allLogs.forEach((log, i) => {
        // Extract date/time directly from ISO string (ignoring timezone)
        let logDateStr = '';
        if (log.logDate instanceof Date) {
          logDateStr = log.logDate.toISOString();
        } else if (typeof log.logDate === 'string') {
          logDateStr = log.logDate;
        } else {
          logDateStr = log.logDate.toString();
        }
        
        const dateTimeMatch = logDateStr.match(/(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (dateTimeMatch) {
          const [, datePart, hour, minute, second] = dateTimeMatch;
          const [year, month, date] = datePart.split('-').map(Number);
          const logDateParsed = moment({
            year: year,
            month: month - 1,
            date: date,
            hour: parseInt(hour),
            minute: parseInt(minute),
            second: parseInt(second)
          });
          console.log(`   ${i + 1}. logDate: ${logDateParsed.format('YYYY-MM-DD HH:mm:ss')} (${log.logDate})`);
        } else {
          console.log(`   ${i + 1}. logDate: Invalid format (${log.logDate})`);
        }
      });
      
      await mongoose.connection.close();
      process.exit(0);
    }

    // Step 6: Update attendance
    console.log('✅ Step 6: Updating attendance...');
    
    if (biometricLogsForDay.length > 0 && !attendance.biometricCheckIn) {
      // Use logDate for biometricCheckIn (ignoring timezone)
      const firstLog = biometricLogsForDay[0];
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
        console.log(`   ✅ Setting biometricCheckIn: ${firstLogTime}`);
      }
    } else if (attendance.biometricCheckIn) {
      console.log(`   ℹ️  biometricCheckIn already set: ${attendance.biometricCheckIn}`);
    }

    if (biometricLogsForDay.length > 0) {
      // Use logDate for biometricCheckOut (ignoring timezone)
      const lastLog = biometricLogsForDay[biometricLogsForDay.length - 1];
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
        const previousCheckOut = attendance.biometricCheckOut;
        attendance.biometricCheckOut = lastLogTime;
        console.log(`   ✅ Updating biometricCheckOut: ${previousCheckOut || 'null'} → ${lastLogTime}`);
      }
    }

    await attendance.save();
    console.log('');

    // Step 7: Verify
    const finalAttendance = await Attendance.findById(attendance._id);
    console.log('✅ Step 7: Final attendance record');
    console.log({
      _id: finalAttendance._id,
      date: finalAttendance.date,
      biometricCheckIn: finalAttendance.biometricCheckIn,
      biometricCheckOut: finalAttendance.biometricCheckOut,
    });

    await mongoose.connection.close();
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testSD116Sync();

