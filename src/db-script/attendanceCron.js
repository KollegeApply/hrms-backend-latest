const mongoose = require('mongoose');
const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
const Helper = require('../utility/helper');
const logger = require('../config/logger');
const { HR_EMAIL, ADMIN_EMAILS } = require('../utility/constants');
const path = require('path');
const moment = require('moment-timezone');
require('dotenv').config({ path: './.env.production' });
// require('dotenv').config({ path: path.resolve(__dirname, '../../.env.development') });

const MONGO_URI = process.env.MONGO_URI;


const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

// Utility to get start of day in IST using moment-timezone
function getKolkataStartOfDay() {
    return moment().tz('Asia/Kolkata').startOf('day').toDate();
}

// Format a date to YYYY-MM-DD
function formatDateYMD(date) {
    return moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD');
}

// Format readable date in 'dd MMMM yyyy' (e.g., 31 July 2025)
function formatReadableDate(date) {
    return moment(date).tz('Asia/Kolkata').format('DD MMMM YYYY');
}

// DAILY CRON JOB
const dailyAttendanceCheck = async () => {
    const todayStartIST = getKolkataStartOfDay();
    const todayEndIST = moment(todayStartIST).add(1, 'day').toDate();

    const cutoffTime = moment(todayStartIST).add(10, 'hours').add(30, 'minutes').toDate(); // 10:30 AM IST

    const minWorkDurationMs = 9 * 60 * 60 * 1000;

     const todayHoliday = await Holiday.findOne({
    date: {
      $gte: todayStartIST,
      $lt: todayEndIST
    },
    isDeleted: false
  });

  if (todayHoliday) {
    logger.info(`Today (${formatDateYMD(todayStartIST)}) is a holiday (${todayHoliday.name || 'Unnamed'}). Skipping attendance check.`);
    return;
  }

    logger.info(`Starting daily attendance check for ${formatDateYMD(todayStartIST)}`);

    try {
        const users = await User.find({
            status: { $in: ["probation", "onroll"] },
            // email: "lokesh.kumar@sportsdunia.com",
            isDeleted: false
        }).populate("teamLeadId", "email");

        for (const user of users) {
            const attendance = await Attendance.findOne({
                user: user._id,
                checkInTime: {
                    $gte: todayStartIST,
                    $lt: todayEndIST
                }
            }).sort({ createdAt: -1 });

            const emailReasons = [];
            const isLeave = attendance?.status === 'leave_applied';

            if (isLeave) {
                logger.info(`User ${user.email} is on leave/WFH, skipping daily attendance check.`);
                continue;
            }

            // Late check-in
            if (
                attendance?.checkInTime &&
                moment(attendance.checkInTime).tz('Asia/Kolkata').isAfter(moment(cutoffTime).tz('Asia/Kolkata'))
            ) {
                const actualCheckInTime = moment(attendance.checkInTime).tz('Asia/Kolkata').format('hh:mm A');

                emailReasons.push(`
    <h3 style="color: #d9534f; margin-top: 0;">Late Check-in</h3>
    <p style="margin: 0; font-size: 15px;">
      Our records show that your check-in today was at <strong>${actualCheckInTime}</strong>. 
      Please ensure to adhere to the expected check-in time.
    </p>
  `);
            }


            // Incomplete Attendance (Checked in, no check-out)
            if (attendance?.checkInTime && !attendance?.checkOutTime) {
                emailReasons.push(`
    <h3 style="color: #f0ad4e; margin-top: 0;">Incomplete Attendance</h3>
    <p style="margin: 0; font-size: 15px;">
      Our records show that you checked in but did not complete a check-out for the day. 
      If this was an oversight, please ensure to complete both check-in and check-out in the future.
    </p>
  `);
            }


            // Early check-out
            if (attendance?.checkInTime && attendance?.checkOutTime) {
                const duration = moment(attendance.checkOutTime).diff(moment(attendance.checkInTime));
                if (duration < minWorkDurationMs) {
                    emailReasons.push(`
            <h3 style="color: #d9534f; margin-top: 0;">Early Check-out</h3>
            <p style="margin: 0; font-size: 15px;">Your total work duration was less than 9 hours. Please ensure you complete your full working day.</p>
          `);
                }
            }

            // Missed attendance
            if (!attendance) {
                emailReasons.push(`
          <h3 style="color: #d9534f; margin-top: 0;">Missed Attendance</h3>
          <p style="margin: 0; font-size: 15px;">
            We did not find any attendance records (check-in or check-out) for you today, 
            and no official leave was recorded in the HRMS. 
            If you have informed your manager or HR through other means (e.g., email), 
            please note that leave must be applied through the HRMS to be considered valid.
          </p>
        `);
            }

            // Send email if issues exist
            if (emailReasons.length > 0) {
                const emailContent = emailReasons.join('<hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">');
                const mailMessage = Helper.dailyAttendanceSummary(
                    `${user.firstName} ${user.lastName}`,
                    formatDateYMD(todayStartIST),
                    emailContent
                );

                const ccEmails = [user?.teamLeadId?.email, HR_EMAIL, ...ADMIN_EMAILS].filter(Boolean);

                await Helper.sendEmail({
                    receiverEmails: [user.email],
                    subject: `Daily Attendance Report for ${formatDateYMD(todayStartIST)}`,
                    message: mailMessage,
                    fromHR: false,
                    cc: ccEmails
                });

                logger.info(`Daily attendance email sent to ${user.email}`);
            }
        }
    } catch (error) {
        logger.error('Error in dailyAttendanceCheck:', error);
    }
};


// WEEKLY SUMMARY JOB
const weeklyAttendanceSummary = async () => {
    const nowIST = moment().tz('Asia/Kolkata');
    const endDate = nowIST.clone().day('Saturday').endOf('day').toDate();
    const startDate = nowIST.clone().day('Monday').startOf('day').toDate();

    logger.info(`Starting weekly attendance summary for week from ${formatDateYMD(startDate)} to ${formatDateYMD(endDate)}`);

    try {
        const users = await User.find({
            // email: "lokesh.kumar@sportsdunia.com", 
            status : {$in : ["probation","onroll"]},
            isDeleted: false,
        }).populate("teamLeadId", "email");

        for (const user of users) {
            const [weeklyRecords, userHolidays] = await Promise.all([
                Attendance.find({
                    user: user._id,
                    $or: [
                        { checkInTime: { $gte: startDate, $lte: endDate } },
                        { date: { $gte: startDate, $lte: endDate }, status: 'leave_applied' }
                    ]
                }),
                Holiday.find({
                    date: { $gte: startDate, $lte: endDate },
                    isDeleted: false
                })
            ]);

            const holidayDates = new Set(
                userHolidays.map(h => moment(h.date).tz('Asia/Kolkata').format('YYYY-MM-DD'))
            );

            const dailyMap = new Map();

            for (const record of weeklyRecords) {
                const dateKey = moment(record.checkInTime || record.date).tz('Asia/Kolkata').format('YYYY-MM-DD');
;

                // Prioritize leave over everything
                if (record.status === 'leave_applied') {
                    dailyMap.set(dateKey, 'Leave');
                } else {
                    const existing = dailyMap.get(dateKey);
                    if (!existing || moment(record.checkInTime).isAfter(existing.checkInTime)) {
                        dailyMap.set(dateKey, record);
                    }
                }
            }

            let summaryHtml = '';

            for (let i = 0; i < 6; i++) { // Mon–Sat
                const currentDay = moment(startDate).add(i, 'days').tz('Asia/Kolkata');
                const dateKey = currentDay.format('YYYY-MM-DD');
                const dateStr = currentDay.format('ddd, MMM D');

                let summaryLine = `<strong>${dateStr}</strong>: `;

                if (holidayDates.has(dateKey)) {
                    summaryLine += 'Holiday';
                } else {
                    const record = dailyMap.get(dateKey);

                    if (record === 'Leave') {
                        summaryLine += 'Leave';
                    } else if (record) {
                        const checkInTime = record.checkInTime
                            ? moment(record.checkInTime).tz('Asia/Kolkata').format('h:mm A')
                            : 'N/A';

                        const checkOutTime = record.checkOutTime
                            ? moment(record.checkOutTime).tz('Asia/Kolkata').format('h:mm A')
                            : 'N/A';

                        let duration = 'N/A';
                        if (record.checkInTime && record.checkOutTime) {
                            const diff = moment(record.checkOutTime).diff(moment(record.checkInTime));
                            const hours = Math.floor(diff / (1000 * 60 * 60));
                            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                            duration = `${hours}h ${minutes}m`;
                        }


                        summaryLine += `Check-in: ${checkInTime}, Check-out: ${checkOutTime}, Duration: ${duration}`;
                    } else {
                        summaryLine += 'No Attendance Recorded';
                    }
                }

                summaryHtml += `<p style="margin: 0; padding-bottom: 5px;">${summaryLine}</p>`;
            }

            if (summaryHtml.trim()) {
                const mailMessage = Helper.weeklyAttendanceSummary(
                    `${user.firstName} ${user.lastName}`,
                    formatReadableDate(startDate),
                    formatReadableDate(endDate),
                    summaryHtml
                );

                const ccEmails = [user?.teamLeadId?.email, HR_EMAIL, ...ADMIN_EMAILS].filter(Boolean);

                await Helper.sendEmail({
                    receiverEmails: [user.email],
                    subject: `Your Weekly Attendance Summary (${formatDateYMD(startDate)} to ${formatDateYMD(endDate)})`,
                    message: mailMessage,
                    fromHR: false,
                    cc: ccEmails
                });

                logger.info(`Weekly summary email sent to ${user.email}`);
            }
        }
    } catch (error) {
        logger.error('Error in weeklyAttendanceSummary:', error);
    }
};




// Script entry point
if (require.main === module) {
    (async () => {
        try {
            await connectDB();
            const mode = process.argv[2] || 'daily';

            if (mode === 'weekly') {
                await weeklyAttendanceSummary();
            } else {
                await dailyAttendanceCheck();
            }

            console.log(`Attendance ${mode} check completed.`);
            process.exit(0);
        } catch (err) {
            console.error('Error running attendance check:', err);
            process.exit(1);
        }
    })();
}

module.exports = {
    dailyAttendanceCheck,
    weeklyAttendanceSummary,
};