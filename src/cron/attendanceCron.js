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
    return moment(date).tz('Asia/Kolkata').format("DD-MM-YYYY");
}

function formatDateWithDay(date) {
    return moment(date).tz('Asia/Kolkata').format("ddd, DD-MM-YYYY");
}


function formatReadableDate(date) {
    return moment(date).tz('Asia/Kolkata').format('DD MMMM YYYY');
}

/**
 * Check if a given date is the 2nd or 4th Saturday of the month (company off days)
 * @param {Date|moment} date - The date to check
 * @returns {boolean} - True if it's 2nd or 4th Saturday, false otherwise
 * 
 * Examples:
 * - Month with 4 Saturdays: 2nd and 4th Saturdays are off
 * - Month with 5 Saturdays: Only 2nd and 4th Saturdays are off (5th Saturday is working day)
 * - This handles all edge cases including months starting on different days
 */
function isAlternateSaturdayOff(date) {
    const momentDate = moment(date).tz('Asia/Kolkata');
    
    // Check if it's Saturday (6 = Saturday in moment.js)
    if (momentDate.day() !== 6) {
        return false;
    }
    
    // Get the first day of the month
    const firstDayOfMonth = momentDate.clone().startOf('month');
    
    // Find all Saturdays in the month
    const saturdays = [];
    let currentDay = firstDayOfMonth.clone();
    
    // Find first Saturday of the month
    while (currentDay.day() !== 6) {
        currentDay.add(1, 'day');
    }
    
    // Collect all Saturdays in the month
    while (currentDay.month() === firstDayOfMonth.month()) {
        saturdays.push(currentDay.clone());
        currentDay.add(7, 'days');
    }
    
    // Find which Saturday of the month the given date is
    const currentSaturday = momentDate.format('YYYY-MM-DD');
    const saturdayIndex = saturdays.findIndex(sat => sat.format('YYYY-MM-DD') === currentSaturday);
    
    // Return true if it's 2nd (index 1) or 4th (index 3) Saturday only
    // This is alternate Saturday off - only 2nd and 4th Saturdays are off
    return saturdayIndex === 1 || saturdayIndex === 3;
}

/**
 * Helper function to get ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
 */
function getSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) {
        return "st";
    }
    if (j === 2 && k !== 12) {
        return "nd";
    }
    if (j === 3 && k !== 13) {
        return "rd";
    }
    return "th";
}

const dailyAttendanceCheck = async (isTestMode = false) => {
    const todayStartIST = getKolkataStartOfDay();
    const todayEndIST = moment(todayStartIST).add(1, 'day').toDate();

    // Check if today is Sunday (0 = Sunday in JavaScript)
    const todayDay = moment(todayStartIST).tz('Asia/Kolkata').day();
    if (todayDay === 0) {
        logger.info(`Today (${formatDateYMD(todayStartIST)}) is Sunday. Skipping daily attendance check.`);
        return;
    }

    // Check if today is an alternate Saturday off (2nd or 4th Saturday of the month)
    if (isAlternateSaturdayOff(todayStartIST)) {
        const momentToday = moment(todayStartIST).tz('Asia/Kolkata');
        const firstDayOfMonth = momentToday.clone().startOf('month');
        let saturdayCount = 0;
        let currentDay = firstDayOfMonth.clone();
        
        // Count which Saturday this is
        while (currentDay.isSameOrBefore(momentToday, 'day')) {
            if (currentDay.day() === 6) {
                saturdayCount++;
            }
            currentDay.add(1, 'day');
        }
        
        logger.info(`Today (${formatDateYMD(todayStartIST)}) is the ${saturdayCount}${getSuffix(saturdayCount)} Saturday of the month (company off day). Skipping daily attendance check.`);
        return;
    }

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

    logger.info(`Starting daily attendance check${isTestMode ? ' (TEST MODE)' : ''} for ${formatDateDMY(todayStartIST)}`);

    try {
        const users = await User.find({
            status: { $in: ["probation", "onroll"] },
            isDeleted: false
        }).populate("teamLeadId", "email")
            .populate("subTeamLeadId", "email");

        for (const user of users) {
            const attendance = await Attendance.findOne({
                user: user._id,
                date: {
                    $gte: todayStartIST,
                    $lt: todayEndIST
                }
            }).sort({ createdAt: -1 });

            const emailReasons = [];
            
            // Check if user is on full day leave or WFH - skip if so
            const isFullLeaveOrWFH = attendance?.status && [
                'leave_applied',
                'leave_applied_full',
                'wfh_applied'
            ].includes(attendance.status);

            if (isFullLeaveOrWFH) {
                logger.info(`User ${user.email} is on full leave/WFH (${attendance.status}), skipping daily attendance check.`);
                continue;
            }

            // Check if user has half-day leave applied (using new leave linkage approach)
            let hasHalfDayLeave = false;
            let halfDayType = null;
            if (attendance?.leaveId) {
                try {
                    const LeaveApplication = require('../models/leaveApplicationModel');
                    const linkedLeave = await LeaveApplication.findById(attendance.leaveId).select('isHalfDay halfDayType');
                    hasHalfDayLeave = !!linkedLeave && linkedLeave.isHalfDay === true;
                    halfDayType = linkedLeave?.halfDayType;
                } catch (err) {
                    // Fallback to old status-based approach if leave lookup fails
                    hasHalfDayLeave = attendance?.status && [
                        'leave_applied_first_half', 
                        'leave_applied_second_half'
                    ].includes(attendance.status);
                    halfDayType = attendance?.status === 'leave_applied_first_half' ? 'first' : 
                                  attendance?.status === 'leave_applied_second_half' ? 'second' : null;
                }
            }

            // Status-based attendance analysis
            if (attendance) {
                // Half-day leave validation logic
                if (hasHalfDayLeave && attendance.checkInTime) {
                    const checkInMoment = moment(attendance.checkInTime).tz('Asia/Kolkata');
                    const checkInHour = checkInMoment.hour();
                    const checkInMinute = checkInMoment.minute();
                    const checkInTimeInMinutes = checkInHour * 60 + checkInMinute;
                    const firstHalfLeaveCutoff = 14 * 60 + 30; // 2:30 PM in minutes
                    const normalCutoff = 10 * 60 + 15; // 10:15 AM in minutes

                    // Check for late check-in based on leave type
                    if (halfDayType === 'first') {
                        if (checkInTimeInMinutes > firstHalfLeaveCutoff) {
                            emailReasons.push(`
                                <h3 style="color: #d9534f; margin-top: 0;">Late Check-in (First Half Leave)</h3>
                                <p style="margin: 0; font-size: 15px;">
                                    You had first half leave applied, but your check-in at <strong>${checkInMoment.format('hh:mm A')}</strong> 
                                    was later than the expected time (2:30 PM). 
                                    Please ensure to check-in by 2:30 PM when you have first half leave.
                                </p>
                            `);
                        }
                    } else if (halfDayType === 'second') {
                        if (checkInTimeInMinutes > normalCutoff) {
                            emailReasons.push(`
                                <h3 style="color: #d9534f; margin-top: 0;">Late Check-in (Second Half Leave)</h3>
                                <p style="margin: 0; font-size: 15px;">
                                    You had second half leave applied, but your check-in at <strong>${checkInMoment.format('hh:mm A')}</strong> 
                                    was later than the expected time (10:15 AM). 
                                    Please ensure to check-in by 10:15 AM when you have second half leave.
                                </p>
                            `);
                        }
                    }

                    // Check for insufficient working hours (less than 4.5 hours)
                    if (attendance.checkOutTime) {
                        const checkOutMoment = moment(attendance.checkOutTime).tz('Asia/Kolkata');
                        const workDurationMs = checkOutMoment.diff(checkInMoment);
                        const workDurationHours = workDurationMs / (1000 * 60 * 60);
                        const requiredHalfDayHours = 4.5;

                        if (workDurationHours < requiredHalfDayHours) {
                            const hoursWorked = Math.floor(workDurationHours);
                            const minutesWorked = Math.floor((workDurationHours % 1) * 60);
                            emailReasons.push(`
                                <h3 style="color: #d9534f; margin-top: 0;">Insufficient Working Hours (Half Day Leave)</h3>
                                <p style="margin: 0; font-size: 15px;">
                                    With half-day leave, you are required to work at least 4.5 hours. 
                                    However, you worked only <strong>${hoursWorked} hours ${minutesWorked} minutes</strong> today. 
                                    Please ensure to complete the required working hours.
                                </p>
                            `);
                        }
                    }
                }

                switch (attendance.status) {
                    case 'late_in':
                        // Skip if already handled in half-day leave logic
                        if (!hasHalfDayLeave) {
                            const checkInTime = attendance.checkInTime ? 
                                moment(attendance.checkInTime).tz('Asia/Kolkata').format('hh:mm A') : 'Unknown time';
                            emailReasons.push(`
                                <h3 style="color: #d9534f; margin-top: 0;">Late Check-in</h3>
                                <p style="margin: 0; font-size: 15px;">
                                    Our records indicate that your check-in today was at <strong>${checkInTime}</strong>, 
                                    which is later than the expected time. 
                                    We kindly remind you to adhere to the standard check-in schedule moving forward.
                                </p>
                            `);
                        }
                        break;
                    
                    case 'early_out':
                        emailReasons.push(`
                            <h3 style="color: #d9534f; margin-top: 0;">Early Check-out</h3>
                            <p style="margin: 0; font-size: 15px;">
                                Our records indicate that your check-out today was earlier than the expected time. 
                                We kindly remind you to complete your full working hours to ensure compliance with company guidelines.
                            </p>
                        `);
                        break;
                    
                    case 'late_in_early_out':
                        const lateCheckInTime = attendance.checkInTime ? 
                            moment(attendance.checkInTime).tz('Asia/Kolkata').format('hh:mm A') : 'Unknown time';
                        emailReasons.push(`
                            <h3 style="color: #d9534f; margin-top: 0;">Late Check-in and Early Check-out</h3>
                            <p style="margin: 0; font-size: 15px;">
                                Our records indicate that you checked in late at <strong>${lateCheckInTime}</strong> 
                                and also checked out earlier than expected. 
                                Please ensure to maintain proper working hours as per company guidelines.
                            </p>
                        `);
                        break;
                    
                    case 'present':
                        // Check for incomplete attendance (checked in but no check-out)
                        // Only flag this if it's after expected work hours (e.g., after 8 PM)
                        const currentHour = moment().tz('Asia/Kolkata').hour();
                        if (attendance.checkInTime && !attendance.checkOutTime && currentHour >= 20) {
                            emailReasons.push(`
                                <h3 style="color: #f0ad4e; margin-top: 0;">Incomplete Attendance</h3>
                                <p style="margin: 0; font-size: 15px;">
                                    It appears you checked in today but didn't complete your check-out.
                                    If this was an oversight, please ensure to complete both check-in and check-out in the future.
                                </p>
                            `);
                        }
                        break;
                }
            } else {
                // No attendance record found - user is absent
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

                if (isTestMode) {
                    logger.info(`   🧪 TEST MODE: Would send attendance email to ${user.email}`);
                    logger.info(`   📧 Subject: Action Required: Attendance Discrepancy Detected for ${formatDateYMD(todayStartIST)}`);
                    logger.info(`   📧 CC: ${ccEmails.join(', ')}`);
                } else {
                    await Helper.sendEmail({
                        receiverEmails: [user.email],
                        subject: `Action Required: Attendance Discrepancy Detected for ${formatDateYMD(todayStartIST)}`,
                        message: mailMessage,
                        fromHR: false,
                        cc: ccEmails,
                        team: user?.team
                    });
                }

                logger.info(`Daily attendance email sent to ${user.email} for status: ${attendance?.status || 'absent'}`);
            }
        }
    } catch (error) {
        logger.error('Error in dailyAttendanceCheck:', error);
    }
};


const weeklyReport = async (isTestMode = false) => {
    const nowIST = moment().tz('Asia/Kolkata');
    const lastWeek = nowIST.clone().subtract(1, 'week');

    const startMoment = lastWeek.clone().isoWeekday(1).startOf('day');
    const endMoment = lastWeek.clone().isoWeekday(6).endOf('day');


    const startDate = startMoment.toDate();
    const endDate = endMoment.toDate();

        const HOURS_PER_DAY = 9;

    logger.info(`Starting weekly report generation${isTestMode ? ' (TEST MODE)' : ''} for all teams: ${formatDateYMD(startDate)} to ${formatDateYMD(endDate)}`);

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

        // Add alternate Saturday offs to holiday dates for weekly report calculation
        for (let i = 1; i <= 6; i++) {
            const currentDay = startMoment.clone().isoWeekday(i);
            if (currentDay.day() === 6 && isAlternateSaturdayOff(currentDay.toDate())) {
                holidayDates.add(formatDateYMD(currentDay.toDate()));
            }
        }


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
                    { date: { $gte: startDate, $lte: endDate }, status: { $in: ['leave_applied_full', 'leave_applied_first_half', 'leave_applied_second_half', 'wfh_applied'] } }
                ]
            });

            const reportData = new Map();
            for (const user of members) {
                reportData.set(user._id.toString(), {
                    user, lateCheckIns: [], earlyCheckOuts: [], lateInEarlyOuts: [], noCheckOuts: [], noAttendances: [],
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
                const dayName = moment(dateKey).tz('Asia/Kolkata').format('ddd'); // Short day name (Mon, Tue, Wed)

                // Handle leave and WFH statuses
                if (['leave_applied', 'leave_applied_full', 'leave_applied_first_half', 'leave_applied_second_half', 'wfh_applied'].includes(record.status) || record.leaveId) {
                    if (!data.attendanceByDate.has(dateKey)) {
                        data.leaveCount++;
                        data.attendanceByDate.set(dateKey, { status: record.status, leaveId: record.leaveId });
                    }
                } else if (record.checkInTime) {
                    // Handle attendance statuses
                    data.attendanceByDate.set(dateKey, record);
                    
                    // Calculate duration for present days
                    if (record.checkInTime && record.checkOutTime) {
                        const duration = moment(record.checkOutTime).diff(moment(record.checkInTime));
                        data.totalDurationMs += duration;
                    }

                    // Track issues based on status
                    switch (record.status) {
                        case 'late_in':
                            data.lateCheckIns.push(dayName);
                            break;
                        case 'early_out':
                            data.earlyCheckOuts.push(dayName);
                            break;
                        case 'late_in_early_out':
                            data.lateInEarlyOuts.push(dayName); // Track combined issue separately
                            break;
                        case 'present':
                            // Check for incomplete attendance (checked in but no check-out)
                            if (record.checkInTime && !record.checkOutTime) {
                                data.noCheckOuts.push(dayName);
                            }
                            break;
                        case 'missed_checkout':
                            // Explicitly track missed checkouts
                            data.noCheckOuts.push(dayName);
                            break;
                        case 'absent':
                            data.noAttendances.push(dayName);
                            break;
                    }
                }
            }

            for (const data of reportData.values()) {
                let workingDaysCount = 0;
                let presentOrLeaveDays = 0;

                for (let i = 1; i <= 6; i++) {
                    const currentDay = startMoment.clone().isoWeekday(i);
                    const dateKey = currentDay.format('YYYY-MM-DD'); // Already timezone-aware from startMoment

                    if (!holidayDates.has(dateKey)) {
                        workingDaysCount++;
                        if (data.attendanceByDate.has(dateKey)) {
                            presentOrLeaveDays++;
                        } else {
                            data.noAttendances.push(currentDay.format('ddd')); // Short day name
                        }
                    }
                }
                data.presentCount = presentOrLeaveDays - data.leaveCount;
                data.absentCount = workingDaysCount - presentOrLeaveDays;

                // RED FLAG LOGIC - Commented out as per requirement
                // const totalWorkingDays = 6 - holidayDates.size;
                // const expectedPresentDays = totalWorkingDays - data.leaveCount;
                // const actualPresentDays = data.presentCount;
                
                // Red flag if:
                // 1. Too many absences (more than 20% of working days)
                // 2. Too many late check-ins (more than 3 days)
                // 3. Too many early check-outs (more than 3 days)
                // const absenceRate = data.absentCount / totalWorkingDays;
                
                // if (absenceRate > 0.2 || data.lateCheckIns.length > 3 || data.earlyCheckOuts.length > 3) {
                //     data.isRedFlagged = true;
                // }
            }

            // BUILD THE HTML TABLE FOR THIS TEAM 
            let tableRows = '';
            for (const data of reportData.values()) {
                const { user, lateCheckIns, earlyCheckOuts, lateInEarlyOuts, noCheckOuts, noAttendances, totalDurationMs, presentCount, leaveCount, absentCount } = data;
                // const hours = Math.floor(totalDurationMs / (1000 * 60 * 60));
                // const minutes = Math.floor((totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
                // const totalHoursFormatted = `${hours} hrs ${minutes} mins`;

                // const workStats = `${presentCount}P, ${leaveCount}L, ${absentCount}A`; // Commented out as requested
                const tdStyle = 'border: 1px solid #ddd; padding: 8px; text-align: left;';
                const employeeInfo = `${user.employeeId || 'N/A'} - ${user.firstName} ${user.lastName}`;

                tableRows += `
                    <tr style="background-color: #f9f9f9;">
                        <td style="${tdStyle}">${user.department?.name || 'N/A'}</td>
                        <td style="${tdStyle}">${employeeInfo}</td>
                        <td style="${tdStyle}">${lateCheckIns.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${earlyCheckOuts.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${lateInEarlyOuts.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${noCheckOuts.join(', ') || 'None'}</td>
                        <td style="${tdStyle}">${noAttendances.join(', ') || 'None'}</td>
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
                if (isTestMode) {
                    logger.info(`   🧪 TEST MODE: Would send weekly report to ${recipients.join(', ')}`);
                    logger.info(`   📧 Subject: Your Team's Weekly Attendance Report (${formatDateWithDay(startDate)} - ${formatDateWithDay(endDate)})`);
                    logger.info(`   📧 CC: ${ccEmails.join(', ')}`);
                } else {
                    await Helper.sendEmail({
                        receiverEmails: recipients,
                        subject: `Your Team's Weekly Attendance Report (${formatDateWithDay(startDate)} - ${formatDateWithDay(endDate)})`,
                        message: mailMessage,
                        fromHR: false,
                        team: teamName,
                        cc: ccEmails,
                    });
                }
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
            const isTestMode = process.argv[3] === 'test';

            console.log(`🧪 Running Attendance Cron${isTestMode ? ' in TEST mode' : ' in normal mode'} for mode: ${mode}`);

            if (mode === 'weekly') {
                await weeklyReport(isTestMode);
            } else if (mode === 'incomplete') {
                await updateIncompleteAttendance(isTestMode);
            } else {
                await dailyAttendanceCheck(isTestMode);
            }

            console.log(`🎯 ${isTestMode ? 'Test' : 'Execution'} completed successfully`);
            process.exit(0);
        } catch (err) {
            console.error('Error running attendance check:', err);
            process.exit(1);
        }
    })();
}

const updateIncompleteAttendance = async (isTestMode = false) => {
    try {
        const now = moment().tz('Asia/Kolkata');
        const todayStart = now.clone().startOf('day');
        const todayEnd = now.clone().endOf('day');

        logger.info(`Starting incomplete attendance update${isTestMode ? ' (TEST MODE)' : ''} for current day: ${formatDateYMD(todayStart.toDate())}`);

        // Check if today is Sunday (0 = Sunday in JavaScript)
        const todayDay = todayStart.day();
        if (todayDay === 0) {
            logger.info(`Today (${formatDateYMD(todayStart.toDate())}) is Sunday. Skipping incomplete attendance update.`);
            return {
                status: 'skipped',
                message: 'Today is Sunday',
                day: 'Sunday'
            };
        }

        // Check if today is an alternate Saturday off (2nd or 4th Saturday of the month)
        if (isAlternateSaturdayOff(todayStart.toDate())) {
            const firstDayOfMonth = todayStart.clone().startOf('month');
            let saturdayCount = 0;
            let currentDay = firstDayOfMonth.clone();
            
            // Count which Saturday this is
            while (currentDay.isSameOrBefore(todayStart, 'day')) {
                if (currentDay.day() === 6) {
                    saturdayCount++;
                }
                currentDay.add(1, 'day');
            }
            
            logger.info(`Today (${formatDateYMD(todayStart.toDate())}) is the ${saturdayCount}${getSuffix(saturdayCount)} Saturday of the month (company off day). Skipping incomplete attendance update.`);
            return {
                status: 'skipped',
                message: `Today is the ${saturdayCount}${getSuffix(saturdayCount)} Saturday of the month (company off day)`,
                day: 'Alternate Saturday Off'
            };
        }

        // Check if today is a holiday
        const todayHoliday = await Holiday.findOne({
            date: {
                $gte: todayStart.toDate(),
                $lt: moment(todayStart).add(1, 'day').toDate()
            },
            isDeleted: false
        });

        if (todayHoliday) {
            logger.info(`Today (${formatDateYMD(todayStart.toDate())}) is a holiday (${todayHoliday.name || 'Unnamed'}). Skipping incomplete attendance update.`);
            return {
                status: 'skipped',
                message: 'Today is a holiday',
                holidayName: todayHoliday.name
            };
        }

        // Find all active users
        const users = await User.find({
            status: { $in: ["probation", "onroll"] },
            isDeleted: false
        });

        let processedCount = 0;
        let markedAbsentCount = 0;
        let skippedCount = 0;
        const markedUsers = [];

        for (const user of users) {
            processedCount++;

            // Find attendance record for today
            const attendance = await Attendance.findOne({
                user: user._id,
                date: {
                    $gte: todayStart.toDate(),
                    $lt: moment(todayStart).add(1, 'day').toDate()
                }
            });

            // Skip users with no attendance record (don't create absent records)
            if (!attendance) {
                skippedCount++;
                logger.debug(`User ${user.email} has no attendance record - skipping (no record creation)`);
                continue;
            }

            // Skip only if user is on full day leave
            if (attendance.status === 'leave_applied_full') {
                skippedCount++;
                logger.debug(`User ${user.email} is on full day leave (${attendance.status}), skipping`);
                continue;
            }

            // Check if user has checked in but no check out
            if (attendance.checkInTime && !attendance.checkOutTime) {
                const oldStatus = attendance.status;
                
                if (isTestMode) {
                    logger.info(`   🧪 TEST MODE: Would mark user ${user.email} as missed_checkout (checked in but no checkout)`);
                    logger.info(`   📝 Status change: ${oldStatus} → missed_checkout`);
                } else {
                    // Mark as missed_checkout when user has checked in but not checked out
                    attendance.status = 'missed_checkout';
                    await attendance.save();
                }

                markedAbsentCount++;
                markedUsers.push({
                    userId: user._id,
                    email: user.email,
                    name: `${user.firstName} ${user.lastName}`,
                    checkInTime: attendance.checkInTime ? 
                        moment(attendance.checkInTime).tz('Asia/Kolkata').format('DD-MM-YYYY HH:mm:ss') : 'No check-in',
                    oldStatus,
                    newStatus: 'missed_checkout'
                });

                logger.info(`${isTestMode ? 'Would mark' : 'Marked'} user ${user.email} as missed_checkout - checked in but no checkout`);
            }
        }

        // Log summary of marked users
        if (markedAbsentCount > 0) {
            logger.info(`Summary: ${markedAbsentCount} users marked as missed_checkout for ${formatDateYMD(todayStart.toDate())}`);
            markedUsers.forEach(user => {
                logger.info(`- ${user.name} (${user.email}): ${user.oldStatus} → ${user.newStatus}`);
            });
        }

        const result = {
            status: 'success',
            message: `Processed ${processedCount} users, marked ${markedAbsentCount} as absent, skipped ${skippedCount}`,
            processedCount,
            markedAbsentCount,
            skippedCount,
            markedUsers: markedUsers.map(u => ({
                email: u.email,
                name: u.name,
                checkInTime: u.checkInTime,
                oldStatus: u.oldStatus,
                newStatus: u.newStatus
            }))
        };

        logger.info(`Incomplete attendance update completed: ${result.message}`);
        return result;

    } catch (error) {
        logger.error('Error in updateIncompleteAttendance:', error);
        return {
            status: 'error',
            message: 'Failed to update incomplete attendance records',
            error: error.message
        };
    }
};

module.exports = {
    dailyAttendanceCheck,
    weeklyReport,
    updateIncompleteAttendance,
};