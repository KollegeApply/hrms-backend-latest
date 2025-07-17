const cron = require('node-cron');
const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { HR_EMAIL } = require('../utility/constants');

cron.schedule('20 10 * * *', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await Attendance.find({ date: today })
        .populate({
            path: 'user',
            populate: { path: 'teamLeadId', select: 'email firstName lastName' }
        })
        .lean();

    for (const log of logs) {
        if (log.status === 'leave_applied' || !log.checkInTime) {
            continue;
        }

        const checkIn = new Date(log.checkInTime);
        if (checkIn.getHours() > 10 || (checkIn.getHours() === 10 && checkIn.getMinutes() > 15)) {
            const user = log.user;


            const subject = `⏰ Late Check-In Alert: ${user.firstName} ${user.lastName}`;
            const message = `
      <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
        <p>Hi <strong>${user.firstName}</strong>,</p>

        <p>We noticed that your check-in for today was recorded at <strong>${checkIn.toLocaleTimeString('en-IN')}</strong>.</p>

        <p>Please be reminded that the official working hours begin at <strong>9:30 AM</strong>, with a grace period until <strong>10:15 AM</strong>. Kindly ensure timely check-ins moving forward to maintain attendance consistency.</p>
        
          <p style="margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
        <p style="margin-top: 30px;">Best regards,<br><strong>Team SportsDunia</strong></p>
      </div>
    `;


            await Helper.sendEmail({
                receiverEmails: [user.email],
                subject,
                message,
                fromHR: false,
                cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
            });
        }
    }
});


cron.schedule('0 21 * * *', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await Attendance.find({ date: today })
        .populate('user')
        .lean();

    for (const log of logs) {
        const user = log.user;
        if (log.status === "leave_applied" || !log.checkInTime || !log.checkOutTime) continue;

        const checkIn = new Date(log.checkInTime);
        const checkOut = new Date(log.checkOutTime);
        const hoursWorked = (checkOut - checkIn) / (1000 * 60 * 60);

        const isEarly = checkOut.getHours() < 18 || (checkOut.getHours() === 18 && checkOut.getMinutes() < 30);
        const isShort = hoursWorked < 9;

        if (isEarly || isShort) {
            const subject = `⏳ Early Checkout / Low Working Hours: ${user.firstName}`;
            const message = `
  <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
    <p>Hi <strong>${user.firstName}</strong>,</p>

    <p>We noticed the following from your attendance today:</p>
    <ul>
      ${isEarly ? `<li>You checked out early at <strong>${checkOut.toLocaleTimeString('en-IN')}</strong>.</li>` : ''}
      ${isShort ? `<li>You worked for only <strong>${hoursWorked.toFixed(2)} hours</strong>.</li>` : ''}
    </ul>

    <p>Please ensure full working hours (9:30 AM to 6:30 PM) are maintained unless pre-approved.</p>

    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      This is an automated message. No action is required unless this becomes frequent.
    </p>

    <p style="margin-top: 30px;">Best regards,<br><strong>Team SportsDunia</strong></p>
  </div>
`;

            await Helper.sendEmail({
                receiverEmails: [user.email],
                subject,
                message,
                fromHR: false,
                cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
            });
        }
    }
});



cron.schedule('15 21 * * *', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await User.find({
        isDeleted: false,
        status: { $in: ['onroll', 'probation'] },
    });

    const logs = await Attendance.find({ date: today }).lean();
    const userLogMap = new Map();
    logs.forEach(log => userLogMap.set(log.user.toString(), log));

    for (const user of users) {
        const log = userLogMap.get(user._id.toString());

        if (log?.status === 'leave_applied') {
            continue;
        }

        let missingType = '';
        if (!log) {
            missingType = 'no attendance record';
        } else if (!log.checkInTime && !log.checkOutTime) {
            missingType = 'missing both check-in and check-out';
        } else if (!log.checkInTime) {
            missingType = 'missing check-in';
        } else if (!log.checkOutTime) {
            missingType = 'missing check-out';
        }

        if (missingType) {
            const subject = `Incomplete Attendance for ${user.firstName}`;
            const message = `
  <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
    <p>Hi <strong>${user.firstName}</strong>,</p>

    <p>Our records show that you have <strong>${missingType}</strong> on <strong>${today.toDateString()}</strong>.</p>

    <p>If this was an error or you were on leave/WFH, please ensure it is updated accordingly.</p>

    <p style="margin-top: 20px; font-size: 12px; color: #999;">
      This is an automated message. No reply is required.
    </p>

    <p style="margin-top: 30px;">Best regards,<br><strong>Team SportsDunia</strong></p>
  </div>
`;


            await Helper.sendEmail({
                receiverEmails: [user.email],
                subject,
                message,
                fromHR: false,
                cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
            });
        }
    }
});

