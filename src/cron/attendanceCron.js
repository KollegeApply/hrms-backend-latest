const mongoose = require('mongoose');
const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const Holiday = require('../models/holidayModel');
const Department = require('../models/departmentModel');
const Helper = require('../utility/helper');
const logger = require('../config/logger');
const { HR_EMAIL, ADMIN_EMAILS, getTeamEmailConfig } = require('../utility/constants');
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
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
};

function getKolkataStartOfDay() {
    return moment().tz('Asia/Kolkata').startOf('day').toDate();
}

function formatDateYMD(date) {
    return moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD');
}

function formatDateDMY(date) {
    return moment(date).format("DD-MM-YYYY");
}

function formatDateWithDay(date) {
    return moment(date).format("ddd, DD-MM-YYYY");
}


function formatReadableDate(date) {
    return moment(date).tz('Asia/Kolkata').format('DD MMMM YYYY');
}

const dailyAttendanceCheck = async () => {
    const todayStartIST = getKolkataStartOfDay();
    const todayEndIST = moment(todayStartIST).add(1, 'day').toDate();

    const cutoffTime = moment(todayStartIST).add(10, 'hours').add(15, 'minutes').toDate();

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

    logger.info(`Starting daily attendance check for ${formatDateDMY(todayStartIST)}`);

    try {
        const users = await User.find({
            status: { $in: ["probation", "onroll"] },
            isDeleted: false
        }).populate("teamLeadId", "email")
            .populate("subTeamLeadId", "email");

        for (const user of users) {
            user.team = "SD";
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
      Our records indicate that your check-in today was at <strong>${actualCheckInTime}</strong>, 
      which is later than the expected time. 
      We kindly remind you to adhere to the standard check-in schedule moving forward.
    </p>
  `);
            }


            // Incomplete Attendance (Checked in, no check-out)
            if (attendance?.checkInTime && !attendance?.checkOutTime) {
                emailReasons.push(`
    <h3 style="color: #f0ad4e; margin-top: 0;">Incomplete Attendance</h3>
    <p style="margin: 0; font-size: 15px;">
      It appears you checked in today but didn’t complete your check-out.
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
            <p style="margin: 0; font-size: 15px;"> Based on our records, your total work duration today was less than the expected 9 hours.
        We kindly remind you to complete your full working hours to ensure compliance with company guidelines.</p>
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
                    emailContent,
                    user.team
                );
                const configEmails = getTeamEmailConfig(user.team);

                const ccEmails = [user?.teamLeadId?.email, user?.subTeamLeadId?.email, configEmails?.HR_EMAIL].filter(Boolean);

                await Helper.sendEmail({
                    receiverEmails: [user.email],
                    subject: `Action Required: Attendance Discrepancy Detected for ${formatDateYMD(todayStartIST)}`,
                    message: mailMessage,
                    fromHR: false,
                    cc: ccEmails,
                    team: user?.team
                });

                logger.info(`Daily attendance email sent to ${user.email}`);
            }
        }
    } catch (error) {
        logger.error('Error in dailyAttendanceCheck:', error);
    }
};


const weeklyReport = async () => {
    const nowIST = moment().tz('Asia/Kolkata');
    const lastWeek = nowIST.clone().subtract(1, 'week');

    const startMoment = lastWeek.clone().isoWeekday(1).startOf('day');
    const endMoment = lastWeek.clone().isoWeekday(6).endOf('day');


    const startDate = startMoment.toDate();
    const endDate = endMoment.toDate();

    const LATE_CHECKIN_CUTOFF_HOUR = 10;
    const LATE_CHECKIN_CUTOFF_MINUTE = 15;
    const MIN_WORK_DURATION_MS = 9 * 60 * 60 * 1000;
    const HOURS_PER_DAY = 9;

    logger.info(`Starting weekly report generation for all teams: ${formatDateYMD(startDate)} to ${formatDateYMD(endDate)}`);

    try {
        const allUsers = await User.find({
            status: { $in: ["probation", "onroll"] },
            isDeleted: false,
            teamLeadId: { $ne: null }
        }).populate("department", "name");

        const usersByTeamLead = new Map();
        const subTeamLeadIds = new Set();

        for (const user of allUsers) {
            if (!user.teamLeadId) continue;
            const tlId = user.teamLeadId.toString();
            if (!usersByTeamLead.has(tlId)) {
                usersByTeamLead.set(tlId, []);
            }
            usersByTeamLead.get(tlId).push(user);

            if (user.subTeamLeadId) {
                subTeamLeadIds.add(user.subTeamLeadId.toString());
            }
        }

        const teamLeadIds = Array.from(usersByTeamLead.keys());

        const teamLeads = await User.find({ '_id': { $in: teamLeadIds } }).select('firstName lastName email team');


        const stlUsers = await User.find({ '_id': { $in: Array.from(subTeamLeadIds) } }).select('email');
        const stlEmailsMap = new Map(stlUsers.map(stl => [stl._id.toString(), stl.email]));

        if (teamLeads.length === 0 && teamLeadIds.length > 0) {
            logger.error('CRITICAL: No team lead documents were found, but users are assigned to them. This indicates a data integrity issue where all team lead references are broken.');
            return;
        }

        // Fetch all holidays for the week once
        const holidays = await Holiday.find({
            date: { $gte: startDate, $lte: endDate },
            isDeleted: false
        });
        const holidayDates = new Set(holidays.map(h => formatDateYMD(h.date)));


        // PROCESS EACH TEAM SEPARATELY 
        for (const [leadId, members] of usersByTeamLead.entries()) {

            const lead = teamLeads.find(l => l._id.toString() === leadId);

            if (!lead || !lead.firstName) {
                logger.warn(`Skipping report for team with lead ID ${leadId} as the lead could not be found.`);
                continue;
            }

            const teamUserIds = members.map(u => u._id);

            const teamAttendance = await Attendance.find({
                user: { $in: teamUserIds },
                $or: [
                    { checkInTime: { $gte: startDate, $lte: endDate } },
                    { date: { $gte: startDate, $lte: endDate }, status: 'leave_applied' }
                ]
            });

            const reportData = new Map();
            for (const user of members) {
                reportData.set(user._id.toString(), {
                    user, lateCheckIns: [], earlyCheckOuts: [], noCheckOuts: [], noAttendances: [],
                    totalDurationMs: 0, presentCount: 0, leaveCount: 0, absentCount: 0,
                    attendanceByDate: new Map(),
                    isRedFlagged: false
                });
            }

            for (const record of teamAttendance) {
                const userId = record.user.toString();
                const data = reportData.get(userId);
                if (!data) continue;

                const dateKey = formatDateYMD(record.checkInTime || record.date);
                const dayName = moment(dateKey).format('dddd');

                if (record.status === 'leave_applied') {
                    if (!data.attendanceByDate.has(dateKey)) {
                        data.leaveCount++;
                        data.attendanceByDate.set(dateKey, { status: 'leave_applied' });
                    }
                } else if (record.checkInTime) {
                    data.attendanceByDate.set(dateKey, record);
                    const checkInTime = moment(record.checkInTime).tz('Asia/Kolkata');
                    const cutoffTime = checkInTime.clone().hour(LATE_CHECKIN_CUTOFF_HOUR).minute(LATE_CHECKIN_CUTOFF_MINUTE).second(0);

                    if (checkInTime.isAfter(cutoffTime)) data.lateCheckIns.push(dayName);
                    if (!record.checkOutTime) data.noCheckOuts.push(dayName);

                    if (record.checkInTime && record.checkOutTime) {
                        const duration = moment(record.checkOutTime).diff(moment(record.checkInTime));
                        data.totalDurationMs += duration;
                        if (duration < MIN_WORK_DURATION_MS) data.earlyCheckOuts.push(dayName);
                    }
                }
            }

            for (const data of reportData.values()) {
                let workingDaysCount = 0;
                let presentOrLeaveDays = 0;

                for (let i = 1; i <= 6; i++) {
                    const currentDay = startMoment.clone().isoWeekday(i);
                    const dateKey = currentDay.format('YYYY-MM-DD');

                    if (!holidayDates.has(dateKey)) {
                        workingDaysCount++;
                        if (data.attendanceByDate.has(dateKey)) {
                            presentOrLeaveDays++;
                        } else {
                            data.noAttendances.push(currentDay.format('dddd'));
                        }
                    }
                }
                data.presentCount = presentOrLeaveDays - data.leaveCount;
                data.absentCount = workingDaysCount - presentOrLeaveDays;

                //  RED FLAG LOGIC 
                const requiredHours = (6 - holidayDates.size - data.leaveCount) * HOURS_PER_DAY;
                const totalHours = data.totalDurationMs / (1000 * 60 * 60);

                if (totalHours < requiredHours) {
                    data.isRedFlagged = true;
                }
            }

            // BUILD THE HTML TABLE FOR THIS TEAM 
            let tableRows = '';
            for (const data of reportData.values()) {
                const { user, lateCheckIns, earlyCheckOuts, noCheckOuts, noAttendances, totalDurationMs, presentCount, leaveCount, absentCount, isRedFlagged } = data;
                const hours = Math.floor(totalDurationMs / (1000 * 60 * 60));
                const minutes = Math.floor((totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
                const totalHoursFormatted = `${hours} hrs ${minutes} mins`;

                const workStats = `${presentCount}P, ${leaveCount}L, ${absentCount}A`;
                const tdStyle = 'border: 1px solid #ddd; padding: 8px; text-align: left;';
                const nameCellStyle = isRedFlagged ? 'background-color: #ffdddd; color: #a60000; font-weight: bold;' : '';

                tableRows += `
                    <tr style="background-color: #f9f9f9;">
                        <td style="${tdStyle}">${user.department?.name || 'N/A'}</td>
                        <td style="${tdStyle}">${user.employeeId || 'N/A'}</td>
                        <td style="${tdStyle}">${user.firstName} ${user.lastName}</td>
                        <td style="${tdStyle}">${lateCheckIns.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${earlyCheckOuts.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${noCheckOuts.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${noAttendances.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${workStats}</td>
                        <td style="${tdStyle}">${totalHoursFormatted}</td>
                    </tr>
                `;
            }

            //  SEND THE EMAIL TO THIS TEAM'S LEAD 
            const teamName = lead.team || "SD";
            const configEmails = getTeamEmailConfig(teamName);
            const recipients = [lead.email];

            // Get the STL email for this team's members
            const subTeamLeadId = members[0]?.subTeamLeadId?.toString();
            const stlEmail = subTeamLeadId ? stlEmailsMap.get(subTeamLeadId) : null;

            const ccEmails = [
                ...(configEmails?.ADMIN_EMAILS || []),
                configEmails?.HR_EMAIL,
                stlEmail
            ].filter(Boolean);

            const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();

            if (recipients[0]) {
                const mailMessage = Helper.teamWeeklyReportEmail(
                    leadName,
                    formatReadableDate(startDate),
                    formatReadableDate(endDate),
                    tableRows,
                    teamName
                );
                await Helper.sendEmail({
                    receiverEmails: recipients,
                    subject: `Your Team's Weekly Attendance Report (${formatDateWithDay(startDate)} - ${formatDateWithDay(endDate)})`,
                    message: mailMessage,
                    fromHR: false,
                    team: teamName,
                    cc: ccEmails,
                });
                logger.info(`Weekly report for team '${lead.firstName}' sent successfully to: ${recipients[0]}`);
            } else {
                logger.warn(`No valid recipient email for team lead: ${leadName}`);
            }
        }
    } catch (error) {
        console.error(error);
        logger.error('Error in weeklyReport job:', error.stack || error);
    }
};

if (require.main === module) {
    (async () => {
        try {
            await connectDB();
            const mode = process.argv[2] || 'daily';

            if (mode === 'weekly') {
                await weeklyReport();
            } else {
                await dailyAttendanceCheck();
            }

            process.exit(0);
        } catch (err) {
            console.error('Error running attendance check:', err);
            process.exit(1);
        }
    })();
}

module.exports = {
    dailyAttendanceCheck,
    weeklyReport,
};