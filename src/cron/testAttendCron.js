const mongoose = require('mongoose');
require('dotenv').config({ path: './.env.development' });

const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { HR_EMAIL } = require('../utility/constants');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.on('connected', async () => {
  console.log('✅ MongoDB connected');

  try {
    await sendLateCheckInNotifications();
    await sendEarlyCheckoutOrShortHours();
    await sendMissingAttendanceNotifications();

    console.log(' All test cron jobs executed');
  } catch (error) {
    console.error(' Error running test cron jobs:', error);
  } finally {
    await mongoose.disconnect();
    console.log(' MongoDB disconnected');
  }
});

// === Late Check-In ===
async function sendLateCheckInNotifications() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const log = await Attendance.findOne({
    user: "6814643026815506bf2fcc1b",
    date: today,
  })
    .sort({ createdAt: 1 })
    .populate({
      path: 'user',
      populate: { path: 'teamLeadId', select: 'email firstName lastName' },
    })
    .lean();

  if (!log || log.status === 'leave_applied' || !log.checkInTime) return;

  const checkIn = new Date(log.checkInTime);
  if (checkIn.getHours() > 10 || (checkIn.getHours() === 10 && checkIn.getMinutes() > 15)) {
    const user = log.user;

    const subject = `⏰ Late Check-In Alert: ${user.firstName} ${user.lastName}`;
    const message = `
      <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
        <p>Hi <strong>${user.firstName}</strong>,</p>
        <p>We noticed that your check-in for today was recorded at <strong>${checkIn.toLocaleTimeString('en-IN')}</strong>.</p>
        <p>Please be reminded that the official working hours begin at <strong>9:30 AM</strong>, with a grace period until <strong>10:15 AM</strong>. Kindly ensure timely check-ins moving forward to maintain attendance consistency.</p>
        <p>This is an automated notification — no action is required unless this becomes a frequent occurrence.</p>
        <p style="margin-top: 30px;">Best regards,<br><strong>Team ${process.env.TEAM}</strong></p>
      </div>
    `;

    await Helper.sendEmail({
      receiverEmails: [user.email],
      subject,
      message,
      fromHR: false,
      cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
    });

    console.log(`[Test] Late check-in email sent to: ${user.email}`);
  }
}

// === Early Checkout / Short Hours ===
async function sendEarlyCheckoutOrShortHours() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const log = await Attendance.findOne({
    user: "6814643026815506bf2fcc1b",
    date: today,
  })
    .sort({ createdAt: 1 })
    .populate({
      path: 'user',
      populate: { path: 'teamLeadId', select: 'email firstName lastName' },
    })
    .lean();

  if (!log || log.status === "leave_applied" || !log.checkInTime || !log.checkOutTime) return;

  const user = log.user;
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
        <p style="margin-top: 20px; font-size: 12px; color: #999;">This is an automated message. No action is required unless this becomes frequent.</p>
        <p style="margin-top: 30px;">Best regards,<br><strong>Team ${process.env.TEAM}</strong></p>
      </div>
    `;

    await Helper.sendEmail({
      receiverEmails: [user.email],
      subject,
      message,
      fromHR: false,
      cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
    });

    console.log(`[Test] Early checkout / short hours email sent to: ${user.email}`);
  }
}

// === Missing Attendance ===
async function sendMissingAttendanceNotifications() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const user = await User.findById("6814643026815506bf2fcc1b")
    .populate({ path: 'teamLeadId', select: 'email firstName lastName' });

  const log = await Attendance.findOne({
    user: user._id,
    date: today,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (log?.status === 'leave_applied') return;

  let missingType = '';
  if (!log) missingType = 'no attendance record';
  else if (!log.checkInTime && !log.checkOutTime) missingType = 'missing both check-in and check-out';
  else if (!log.checkInTime) missingType = 'missing check-in';
  else if (!log.checkOutTime) missingType = 'missing check-out';

  if (missingType) {
    const subject = `🚫 Incomplete Attendance for ${user.firstName}`;
    const message = `
      <div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
        <p>Hi <strong>${user.firstName}</strong>,</p>
        <p>We noticed that your attendance record for <strong>${today.toDateString()}</strong> is marked as <strong>${missingType}</strong>.</p>
        <p>If you were on approved leave or working from home (WFH), please make sure this is updated in the system. Otherwise, kindly ensure your attendance is properly logged going forward.</p>
        <p style="margin-top: 20px; font-size: 12px; color: #999;">This is an automated notification. No action is needed unless there is a discrepancy.</p>
        <p style="margin-top: 30px;">Best regards,<br><strong>Team ${process.env.TEAM}</strong></p>
      </div>
    `;

    await Helper.sendEmail({
      receiverEmails: [user.email],
      subject,
      message,
      fromHR: false,
      cc: [user.teamLeadId?.email, HR_EMAIL].filter(Boolean),
    });

    console.log(`[Test] Missing attendance email sent to: ${user.email}`);
  }
}
