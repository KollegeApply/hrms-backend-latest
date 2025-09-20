// src/utility/helper.js
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const {
  MAIL_HOST,
  MAIL_PORT,
  MAIL_SECURE,
  MAIL_SERVICE,
  MAIL_FROM_HR,
  MAIL_FROM_SUPPORT,
  MAIL_USER,
  MAIL_PASS,
  HR_MAIL_USER,
  HR_MAIL_PASS,
  IT_MAIL_USER,
  IT_MAIL_PASS,
  MAIL_FROM_IT,
  TEAM_KAP,
  TEAM_SD,
  getTeamEmailConfig,
} = require('./constants');
const { OTP_EXPIRY_MINUTES } = require('./constants');
const { formatDateToKolkata } = require('./common');
const moment = require('moment-timezone');

class Helper {
  /**
   * Checks if a given string is a valid MongoDB ObjectId.
   * @param {string} id - The ID string to validate.
   * @returns {boolean} - True if valid, false otherwise.
   */
  static isValidMongoId(id) {
    return mongoose.Types.ObjectId.isValid(id);
  }

  /**
   * Sends an email using Nodemailer.
   * @param {object} mailData - Email data.
   * @param {string[]} mailData.receiverEmails - Array of recipient email addresses.
   * @param {string} mailData.subject - Email subject line.
   * @param {string} mailData.message - Email body (HTML).
   * @param {Array} mailData.attachments - Array of attachment objects.
   * @returns {Promise<void>}
   */
  static async sendEmail({
    receiverEmails,
    subject,
    message,
    fromHR = false,
    fromIT = false,
    cc = [],
    team,
    attachments = [],
  }) {
    if (!team) {
      logger.error('Team must be provided to send email.');
      return;
    }

    let config;
    try {
      config = getTeamEmailConfig(team);
    } catch (err) {
      logger.error(`Invalid team configuration: ${err.message}`);
      return;
    }

    let user = config.MAIL_USER;
    let pass = config.MAIL_PASS;
    let from = `"Support" <${config.MAIL_FROM_SUPPORT}>`;

    if (fromHR) {
      user = config.HR_MAIL_USER;
      pass = config.HR_MAIL_PASS;
      from = `"HR Department" <${config.MAIL_FROM_HR}>`;
    } else if (fromIT) {
      user = config.IT_MAIL_USER;
      pass = config.IT_MAIL_PASS;
      from = `"IT Department" <${config.MAIL_FROM_IT}>`;
    }

    if (!user || !pass) {
      logger.error('SMTP credentials are missing for the selected sender.');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: parseInt(MAIL_PORT, 10),
      secure: MAIL_SECURE === 'true',
      ...(MAIL_SERVICE && { service: MAIL_SERVICE }),
      auth: { user, pass },
    });

    const mailOptions = {
      from,
      to: receiverEmails.join(','),
      cc: cc.length > 0 ? cc.join(',') : undefined,
      subject,
      html: message,
      ...(attachments.length > 0 && { attachments }),
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${receiverEmails.join(', ')} | ID: ${info.messageId}`);
    } catch (error) {
      logger.error('Failed to send email:', error?.message || error);
    }
  }


  /**
   * Generates a welcome email template for new HRMS users.
   * @param {string} name - User's first name.
   * @param {string} userEmail - User's email address.
   * @param {string} role - User's assigned role.
   * @param {string} password - The initially generated password (handle securely!).
   * @param {string} loginUrl - URL to the HRMS login page.
   * @returns {string} - HTML email content.
   */
  static getWelcomeEmail(firstName, userEmail, password, loginUrl, team) {
    // SECURITY NOTE: Sending passwords via email is generally discouraged.
    // Consider sending a password reset link instead.
    // This template includes the password as requested based on the LMS example.
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">Welcome to ${team}!</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">Hi <strong>${firstName}</strong>,</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Welcome aboard! We're excited to have you as part of the <strong>${team}</strong> family.
    </p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Your account has been successfully set up. Here's what you need to log in:
    </p>

    <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
      <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Login Credentials</h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Username:</strong> ${userEmail}</li>
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Temporary Password:</strong> <code style="background: #eee; padding: 2px 5px; border-radius: 3px;">${password}</code></li>
      </ul>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Please change your password after your first login for security reasons.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Login to ${team}</a>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Welcome again, and let’s get started!
    </p>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Cheers!<br><strong>Team ${team}</strong></p>
  </div>
  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>

    `;
  }

  /**
   * Generates a password reset email template using OTP.
   * @param {string} otp - The One-Time Password.
   * @returns {string} - HTML email content.
   */
  static getOTPEmail(otp) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #333;">Your Password Reset OTP</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Dear User,</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">We received a request to reset the password for your HRMS account.</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Use the following One-Time Password (OTP) to complete your password reset process:</p>
            <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; text-align: center; border-left: 4px solid #66f;">
                <h2 style="color: #333; font-size: 24px; margin: 0; letter-spacing: 2px; font-weight: bold;">${otp}</h2>
            </div>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">This OTP is valid for <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
            <p style="color: #777; font-size: 14px; line-height: 1.5; margin-top: 30px;">For security reasons, do not share this OTP with anyone.</p>
            <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Support Team</strong></p>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated message. Please do not reply directly to this email. If you need help, contact HR.
        </div>
    </div>
    `;
  }

  static leaveWFHApproval(userName, requestType, date, leaveType = '', reason, team, jobTitle, employeeId, department) {
    const displayTeam = getTeamEmailConfig(team);

    // Extract firstName from full name for greeting
    const firstName = userName.split(' ')[0];

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">${requestType} Request Approved</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Hi <strong>${firstName}</strong>,
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Your <strong>${requestType}</strong> request on <strong>${date}</strong> has been approved.
    </p>

    <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
      <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Request Details</h2>
      
      <!-- Employee Information Section -->
      <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${userName} (${employeeId || 'N/A'})</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> N/A</li>
        </ul>
      </div>

      <!-- Leave Details Section -->
      <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Leave Details</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${requestType === 'Leave' ? `<li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date:</strong> ${date}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>
        </ul>
      </div>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      If you have any pending tasks, kindly ensure they’re handed over before you sign off.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Let us know if anything changes.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Take care and enjoy your time!
    </p>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
  </div>
  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>

    `;
  }

  static WfhLeaveRevoked(
    userName,
    requestType,
    date,
    leaveType = '',
    reason = '',
    team,
    employeeInfo = null,
  ) {

    const displayTeam = getTeamEmailConfig(team);

    // Extract firstName from full name for greeting
    const firstName = userName.split(' ')[0];

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #333;">${requestType} Request Revoked</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hello Team,
          </p>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            <strong>${userName}</strong> has revoked their ${requestType} request. Please see the details below:
          </p>

          ${employeeInfo ? `
          <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
            </ul>
          </div>
          ` : ''}
  
          <div style="background-color: #ffecec; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ff4c4c;">
            <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Revocation Details</h2>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${userName} (${employeeId || 'N/A'})</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> N/A</li>
            </ul>
          </div>

          <!-- Request Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Request Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              ${requestType === 'Leave' ? `<li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date(s):</strong> ${Array.isArray(date) ? date.join(', ') : date}</li>
              ${reason ? `<li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>` : ''}
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: #dc3545; font-weight: bold;">Revoked by Employee</span></li>
            </ul>
          </div>
        </div>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <p style="color: #0c5460; font-size: 14px; margin: 0;">
            <strong>Important:</strong> Please make note of this change and adjust any responsibilities or schedules accordingly. The request has been cancelled and will no longer be processed.
          </p>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  static fullTimeConversion(userName, tlName, date, jobTitle, team) {
    const displayTeam = getTeamEmailConfig(team);

    const formattedDate = moment.tz(date, 'Asia/Kolkata').format('DD MMMM YYYY');
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #28a745;">🎉 You’ve Earned Full-Time Status! 🎉</h1>
    <h2 style="color: #333; font-size: 20px;">Congratulations!</h2>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Hi <strong>${userName}</strong>,
    </p>
    
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      It is with pleasure that we confirm your transition to full-time employment with <strong>${displayTeam?.TEAM_NAME}</strong>, effective from <strong>${formattedDate}</strong>.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      We are delighted with your performance during the probation period and excited to have you as a full-time member of our team.
    </p>

    <div style="background-color: #eaffea; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #28a745;">
      <h2 style="color: #2f8132; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Your Confirmation Details</h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Job Title:</strong> ${jobTitle}</li>
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Employment Status:</strong> Confirmed Full-Time</li>
        <li style="color: #555; font-size: 15px;"><strong>Effective Date:</strong> ${formattedDate}</li>
      </ul>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Thank you for your dedication and the contributions you’ve made thus far. We look forward to seeing your continued growth and success in your role.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Should you have any questions regarding your full-time employment status, benefits, or other updates, feel free to contact <a href="mailto:${process?.env?.HR_EMAIL}" style="color: #007bff;">${process?.env?.HR_EMAIL}</a>.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Congratulations once again!
    </p>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
  </div>
  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>

    `;
  }

  static WfhLeaveApplication({
    userName,
    tlName,
    requestType,
    leaveType = '',
    fromDate,
    toDate,
    reason,
    dashboardUrl,
    team,
    isHalfDay = false,
    halfDayType,
    employeeInfo = null,
  }) {
    const fromMoment = moment(fromDate).tz('Asia/Kolkata');
    const toMoment = moment(toDate).tz('Asia/Kolkata');


    let leaveMessage = '';

    if (fromMoment.isSame(toMoment, 'day')) {
      leaveMessage = `${fromMoment.format('DD MMMM YYYY')}`;
    } else {
      leaveMessage = `${fromMoment.format('DD MMMM YYYY')} to ${toMoment.format('DD MMMM YYYY')}`;
    }

    // Modify leave type to include half-day information
    let displayLeaveType = leaveType;
    if (isHalfDay) {
      const halfDayText = halfDayType === 'first' ? 'First Half' : 'Second Half';
      displayLeaveType = `${leaveType} (${halfDayText})`;
    }

    const displayTeam = getTeamEmailConfig(team);

    return `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #333;">${requestType} Request Notification</h2>
        </div>
  
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hello ${tlName},
          </p>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            <strong>${userName}</strong> has requested for <strong>${requestType}</strong> for the following period:
          </p>

          ${employeeInfo ? `
          <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
              <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
            </ul>
          </div>
          ` : ''}
  
          <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
            <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Request Details</h2>
            <ul style="list-style: none; padding: 0; margin: 0;">
              ${requestType === 'Leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${displayLeaveType}</li>` : ''}
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Date:</strong> ${leaveMessage}</li>
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
            </ul>
          </div>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Kindly review and take necessary actions.
          </p>

          <div style="text-align: center; margin-top: 30px;">
          <a href="${dashboardUrl}/leave" style="background-color:#66f; color:rgb(246, 249, 251); padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px; font-weight: bold;">
            Review Leave Request
          </a>
        </div>
  
          <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>${displayTeam?.TEAM_NAME} Support Team</strong></p>
        </div>
  
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated notification. Please do not reply to this email directly.
        </div>
      </div>
    `;
  }

  static leaveWFHReject(userName, requestType, date, leaveType, reason) {
    // Extract firstName from full name for greeting
    const firstName = userName.split(' ')[0];

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #d9534f;">${requestType} Request Declined</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${firstName}</strong>,
        </p>
  
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          We regret to inform you that your <strong>${leaveType}</strong> ${requestType.toLowerCase()} request for <strong>${date}</strong> has been declined.
        </p>
  
   <!--     
   <div style="background-color: #ffecec; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #d9534f;">
          <h2 style="color: #b52b27; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Reason Provided</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0;">
            ${reason}
          </p>
        </div> 
  -->
  
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          We completely understand if this is disappointing, and we’re happy to work with you on finding an alternative date or a solution that works for you.
        </p>
  
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Let us know if you'd like to discuss further.
        </p>
  
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Thank you for your understanding.
        </p>
  
        <p style="color: #777; font-size: 14px; line-height: 1.5;">Regards,<br><strong>Team ${process?.env?.TEAM}</strong></p>
      </div>
      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
    `;
  }


  static getAssetReturnRequestEmail(firstName, employeeId, assetName, assetType, dashboardUrl, jobTitle, department, teamLeadName) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #333;">Asset Return Request</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello Team,</p>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          The following employee has submitted a return request for an assigned asset:
        </p>

        <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${firstName} (${employeeId})</li>
            <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
            <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
            <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
          </ul>
          
          <h3 style="color: #495057; font-size: 15px; margin: 20px 0 10px 0; font-weight: 600;">Asset Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Name:</strong> ${assetName}</li>
            <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
          </ul>
        </div>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You can review and process the request in the <a href="${dashboardUrl}/assets" style="color: #007bff;">HRMS dashboard</a>.
        </p>

        <p style="color: #999; font-size: 14px;">This is an automated email. Please do not reply.</p>
      </div>
    </div>
  `;
  }



  static getAssetAssignmentEmail(firstName, assetName, assetType, loginUrl, team, jobTitle, employeeId, department, teamLeadName) {
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">Asset Assignment Notification</h1>
  </div>

  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Hi <strong>${firstName}</strong>,
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You have been assigned a new asset: <strong>${assetName}</strong> (Asset Type: ${assetType}).
    </p>

    <!-- Employee Information Section -->
    <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
      <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${firstName} (${employeeId || 'N/A'})</li>
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
        <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
      </ul>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Please review and acknowledge the receipt of this asset.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You can log in to the HRMS to view and acknowledge your assets.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${loginUrl}/dashboard" style="background-color: #007bff; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Go to Dashboard</a>
    </div>

    <p style="color: #777; font-size: 14px;">Thank you,<br>IT Department</p>
  </div>

  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>
  `;
  }


  static getAssetAcknowledgmentEmail(
    employeeName,
    employeeId,
    assetName,
    assetType,
    dashboardUrl,
    jobTitle,
    department,
    teamLeadName
  ) {
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">Asset Acknowledgment Confirmation</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello Team,</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      The following asset has been successfully acknowledged by the employee:
    </p>

    <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
      <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${employeeName} (${employeeId})</li>
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
        <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
      </ul>
      
      <h3 style="color: #495057; font-size: 15px; margin: 20px 0 10px 0; font-weight: 600;">Asset Information</h3>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Name:</strong> ${assetName}</li>
        <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
      </ul>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You can review the asset acknowledgment in the dashboard.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${dashboardUrl}/assets/assigned" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">View Asset Details</a>
    </div>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Thank you,<br>IT Department</p>
  </div>
  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>
  `;
  }

  static getAssetReturnStatusEmail(firstName, employeeId, assetName, assetType, status, dashboardUrl, jobTitle, department, teamLeadName) {
    const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

    return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #fdfdfd;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #333; font-size: 22px;">Asset Return Request ${capitalizedStatus}</h2>
    </div>

    <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
        Hello <strong>${firstName}</strong>,
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
        Your asset return request has been ${capitalizedStatus}. Below are the request details:
      </p>

      <!-- Employee Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${firstName} (${employeeId})</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
        </ul>
      </div>

      <!-- Asset Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Asset Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Name:</strong> ${assetName}</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${capitalizedStatus}</span></li>
        </ul>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${dashboardUrl}" style="background-color: #007bff; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          View Request in Dashboard
        </a>
      </div>

      <p style="font-size: 14px; color: #777; line-height: 1.5; margin-bottom: 24px;">
        If you have any questions or concerns, please feel free to contact the IT department.
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.6; margin-bottom: 8px;">
        Thanks & regards,<br>
        <strong>IT Department</strong>
      </p>
    </div>

    <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
      This is an automated message. Please do not reply directly to this email.
    </div>
  </div>
  `;
  }



  static getAssetRejectionEmail(
    employeeName,
    employeeId,
    assetName,
    assetType,
    dashboardUrl,
    jobTitle,
    department,
    teamLeadName,
    rejectionReason
  ) {
    return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #dc3545; font-size: 22px;">Asset Rejection Notification</h2>
    </div>

    <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
        Hello Team,
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
        The following asset has been <strong>rejected</strong> by the employee:
      </p>

      <!-- Employee Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${employeeName} (${employeeId})</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
        </ul>
      </div>

      <!-- Asset Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Asset Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Name:</strong> ${assetName}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
        </ul>
      </div>

      <!-- Rejection Reason Section -->
      ${rejectionReason ? `
      <div style="background-color: #fff3cd; padding: 16px 20px; border-radius: 6px; border: 1px solid #ffeaa7; margin: 20px 0;">
        <h3 style="color: #856404; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Rejection Reason</h3>
        <p style="color: #856404; margin: 0; font-size: 14px; line-height: 1.5; font-style: italic;">
          "${rejectionReason}"
        </p>
      </div>
      ` : ''}

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 20px;">
        You can review this rejection in the dashboard below:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${dashboardUrl}/assets" style="background-color: #dc3545; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          View Rejected Asset
        </a>
      </div>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 8px;">
        Thank you,<br>
        <strong>IT Department</strong>
      </p>
    </div>

    <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
      This is an automated message. Please do not reply directly to this email.
    </div>
  </div>
  `;
  }



  static getAssetReceivedConfirmationEmail(firstName, employeeId, assetName, assetType, dashboardUrl, jobTitle, department, teamLeadName) {
    return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #28a745; font-size: 22px;">Asset Received Confirmation</h2>
    </div>

    <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
        Hello Team,
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
        The following asset has been successfully <strong>returned and received</strong> from the employee:
      </p>

      <!-- Employee Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${firstName} (${employeeId})</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName || 'N/A'}</li>
        </ul>
      </div>

      <!-- Asset Information Section -->
      <div style="background-color: #f8f9fa; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin: 20px 0;">
        <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Asset Information</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Name:</strong> ${assetName}</li>
          <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
        </ul>
      </div>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 20px;">
        You can review the full record in the dashboard below:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${dashboardUrl}" style="background-color: #007bff; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Go to HRMS Dashboard
        </a>
      </div>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 8px;">
        Thank you,<br>
        <strong>IT Department</strong>
      </p>
    </div>

    <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
      This is an automated message. Please do not reply directly to this email.
    </div>
  </div>
  `;
  }

  static getFeedbackEmail({ givenByUser, givenToUser, dashboardUrl, feedbackId, team }) {
    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">Feedback Notification</h2>
      </div>

      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hello <strong>${givenToUser?.firstName} ${givenToUser?.lastName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You have received new feedback from <strong>${givenByUser?.firstName} ${givenByUser?.lastName}</strong>.
        </p>

        <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
          <h3 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Action Required</h3>
          <p style="color: #555; font-size: 15px; margin: 0;">
            Please review the feedback in the HRMS system using the button below.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks/view/${feedbackId}" 
             style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Feedback
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>${displayTeam?.TEAM_NAME || 'HRMS'} Support Team</strong></p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated notification. Please do not reply to this email directly.
      </div>
    </div>
  `;
  }

  static getConcernRaiseEmail({
    raisedByUser,
    dashboardUrl,
    feedbackId,
    team,
  }) {

    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #b91c1c;">Concern Raised on Feedback</h2>
      </div>

      <div style="background-color: #ffffff; padding: 25px; border-radius: 8px;">
        <p style="font-size: 16px; color: #555;">
          Hello,
        </p>

        <p style="font-size: 16px; color: #555;">
          <strong>${raisedByUser.firstName} ${raisedByUser.lastName}</strong> has raised a concern on a feedback.
        </p>

        <div style="background-color: #fee2e2; padding: 15px 20px; border-left: 4px solid #dc2626; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0; font-size: 15px; color: #b91c1c;">
            Please review the concern and take appropriate action.
          </p>
        </div>

        <p style="font-size: 16px; color: #555;">
          <a href="${dashboardUrl}/feedbacks/view/${feedbackId}" style="color: #dc2626; text-decoration: none;">Click here to view the feedback</a>.
        </p>

        <p style="color: #777; font-size: 14px; margin-top: 30px;">
          Best regards,<br><strong>${displayTeam?.TEAM_NAME || 'HRMS'} Support Team</strong>
        </p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated message. Please do not reply to this email.
      </div>
    </div>
  `;
  }

  static getEditRequestEmail({
    givenByUser,
    givenToUser,
    dashboardUrl,
    feedbackId,
    team,
  }) {
    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #fefefe;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #1f2937;">Edit Request for Submitted Feedback</h2>
      </div>

      <div style="background-color: #ffffff; padding: 25px; border-radius: 8px;">
        <p style="font-size: 16px; color: #333;">
          Hello HR Team,
        </p>

        <p style="font-size: 16px; color: #333;">
          <strong>${givenByUser.firstName} ${givenByUser.lastName}</strong> has requested to edit the feedback previously given to 
          <strong>${givenToUser.firstName} ${givenToUser.lastName}</strong>.
        </p>

        <p style="font-size: 15px; color: #555; margin-top: 20px;">
          Please review and approve the request if valid. Editing will be enabled only upon your approval.
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks" 
             style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            Review Edit Request
          </a>
        </div>

        <p style="color: #666; font-size: 14px;">Thank you,<br><strong>${displayTeam?.TEAM_NAME || 'HRMS'} Support Team</strong></p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
  `;
  }

  static getEditRequestStatusEmail({
    givenByUser,
    givenToUser,
    status,
    dashboardUrl,
    feedbackId,
    team,
  }) {
    const isApproved = status === 'approved';
    const subjectText = isApproved ? 'approved' : 'rejected';
    const color = isApproved ? '#16a34a' : '#dc2626';

    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #fefefe;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: ${color};">Your Feedback Edit Request has been ${subjectText}</h2>
      </div>

      <div style="background-color: #ffffff; padding: 25px; border-radius: 8px;">
        <p style="font-size: 16px; color: #333;">
          Hello <strong>${givenByUser.firstName} ${givenByUser.lastName}</strong>,
        </p>

        <p style="font-size: 15px; color: #555;">
          Your request to edit feedback for <strong>${givenToUser.firstName} ${givenToUser.lastName}</strong> has been <strong>${subjectText}</strong> by the HR team.
        </p>

        ${isApproved
        ? `<p style="font-size: 15px; color: #555;">You can now update the feedback in the system.</p>`
        : `<p style="font-size: 15px; color: #555;">Please contact HR if you believe this was a mistake.</p>`
      }

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks/view/${feedbackId}" 
             style="display: inline-block; background-color: ${color}; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Feedback
          </a>
        </div>

        <p style="color: #777; font-size: 14px;">Best regards,<br><strong>${displayTeam?.TEAM_NAME || 'HRMS'} Support Team</strong></p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated message. Please do not reply directly.
      </div>
    </div>
  `;
  }

  static getFeedbackUpdatedEmail({
    givenByUser,
    givenToUser,
    dashboardUrl,
    feedbackId,
    team,
  }) {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #1e40af;">Feedback Updated Notification</h2>
      </div>

      <div style="background-color: #f9fafb; padding: 30px; border-radius: 8px;">
        <p style="font-size: 16px; color: #374151;">
          Hello <strong>${givenToUser.firstName} ${givenToUser.lastName}</strong>,
        </p>

        <p style="font-size: 16px; color: #374151;">
          The feedback previously shared with you by <strong>${givenByUser.firstName} ${givenByUser.lastName}</strong> has been <strong>updated</strong>.
        </p>

        <div style="background-color: #e0f2fe; padding: 15px 20px; border-left: 4px solid #3b82f6; border-radius: 5px; margin: 25px 0;">
          <p style="margin: 0; font-size: 15px; color: #1e3a8a;">
            Please review the updated feedback in the HRMS system.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks/view/${feedbackId}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Updated Feedback
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px;">
          Best regards,<br><strong>${displayTeam?.TEAM_NAME || 'HRMS'} Support Team</strong>
        </p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #9ca3af;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
  `;
  }

  /**
   * Section approval request email to HR with Approve/Reject buttons
   */
  static getSectionApprovalRequestEmail({
    employeeName,
    section,
    approveUrl,
    rejectUrl,
    team,
  }) {
    const displayTeam = getTeamEmailConfig(team);
    const sectionLabel = section === 'bankDetails' ? 'Bank Details' : 'Documents';
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fff;">
      <h2 style="margin: 0 0 12px; color:#111827;">Approval Request - ${sectionLabel}</h2>
      <p style="margin: 0 0 16px; color:#374151;">
        <strong>${employeeName}</strong> is requesting permission to edit their ${sectionLabel} section.
      </p>
      <div style="display:flex; gap:12px; margin: 18px 0;">
        <a href="${approveUrl}" style="background:#16a34a;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;">Approve</a>
        <a href="${rejectUrl}" style="background:#dc2626;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;">Reject</a>
      </div>
      <p style="font-size: 12px; color:#6b7280;">This link will expire in 7 days.</p>
      <p style="font-size: 12px; color:#6b7280;">Regards, <strong>Team ${displayTeam?.TEAM_NAME || 'HRMS'}</strong></p>
    </div>`;
  }

  /**
   * Section approval status email to employee
   */
  static getSectionApprovalStatusEmail({
    employeeName,
    section,
    status,
    reason,
    team,
  }) {
    const displayTeam = getTeamEmailConfig(team);
    const sectionLabel = section === 'bankDetails' ? 'Bank Details' : 'Documents';
    const approved = status === 'approved';
    const color = approved ? '#16a34a' : '#dc2626';
    const verb = approved ? 'Approved' : 'Rejected';
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fff;">
      <h2 style="margin: 0 0 12px; color:${color};">${sectionLabel} ${verb}</h2>
      <p style="margin: 0 0 12px; color:#374151;">Hello ${employeeName},</p>
      <p style="margin: 0 0 16px; color:#374151;">Your request to edit ${sectionLabel} has been <strong>${verb.toLowerCase()}</strong>.</p>
      ${approved ? '' : (reason ? `<p style="margin: 0 0 12px; color:#374151;"><strong>Reason:</strong> ${reason}</p>` : '')}
      <p style="font-size: 12px; color:#6b7280;">Regards, <strong>Team ${displayTeam?.TEAM_NAME || 'HRMS'}</strong></p>
    </div>`;
  }

  static getTicketCreatedEmailForTeam(subject, type, raisedByName, baseUrl, ticketId, team) {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">New Ticket Created</h2>
        <p style="font-size: 14px; color: #777;">Ticket ID: <strong>${ticketId}</strong></p>
      </div>
      
      <div style="background-color: #fff; padding: 20px; border-radius: 8px;">
        <p style="font-size: 16px; color: #555;">Hello Team,</p>
        <p style="font-size: 16px; color: #555;">
          A new <strong>${type}</strong> ticket has been raised by <strong>${raisedByName}</strong>.
        </p>

        <p style="font-size: 16px; color: #555;"><strong>Subject:</strong> ${subject}</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${baseUrl}/tickets" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            View Ticket in Dashboard
          </a>
        </div>
        
        <p style="font-size: 14px; color: #777;">Best regards,<br><strong>${displayTeam?.TEAM_NAME} Support Team</strong></p>
      </div>

      <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
  `;
  }


  static getTicketStatusUpdateEmail(employeeName, subject, status, baseUrl, ticketId, teamName, reason = '') {
    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);
    const statusColor =
      status === "approved"
        ? "#28a745"
        : status === "rejected"
          ? "#dc3545"
          : "#007bff";

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">Ticket Status Updated</h2>
        <p style="font-size: 14px; color: #777;">Ticket ID: <strong>${ticketId}</strong></p>
      </div>

      <div style="background-color: #fff; padding: 25px; border-radius: 8px;">
        <p style="font-size: 16px; color: #555;">Hi <strong>${employeeName}</strong>,</p>
        <p style="font-size: 16px; color: #555;">
          Your ticket regarding <strong>${subject}</strong> has been 
          <strong style="color: ${statusColor};">${capitalizedStatus}</strong>.
        </p>

        ${reason && reason.trim() !== '' ? `
        <div style="background-color:#f8f9fa; padding:14px 16px; border-left:4px solid #6c757d; border-radius:6px; margin: 18px 0;">
          <p style="margin:0; font-size:14px; color:#495057;"><strong>Closure Remark:</strong> ${reason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${baseUrl}/tickets" target="_blank" rel="noopener noreferrer"
             style="background-color: #007bff; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-weight: bold;">
            View Ticket
          </a>
        </div>

        <p style="font-size: 15px; color: #555;">
          If you need further assistance, please contact your HR or support team.
        </p>

        <p style="font-size: 14px; color: #777; margin-top: 30px;">
          Best regards,<br>
          <strong>${teamName} Support Team</strong>
        </p>
      </div>

      <div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
  `;
  }


  static getCandidateInviteEmail(candidate, inviteLink, team) {
    const displayTeam = getTeamEmailConfig(team);

    return `
      <p>Dear ${candidate?.firstName},</p>
  
      <p>Welcome On-Board! We're excited to have you as part of the ${displayTeam?.TEAM_NAME} family.</p>
  
      <p>
        Please complete your Candidate Information Form (CIF) by clicking the button below.
        This form will be valid for <strong>7 days</strong> from the date you received this email.
      </p>
  
      <p>
        <a href="${inviteLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #007bff; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
          Access Your Form
        </a>
      </p>
  
      <p>The Candidate Information Form (CIF) is a comprehensive form that helps us collect essential information required at onboarding. Please be prepared to provide the following types of details:</p>
  
      <ul>
        <li><strong>Personal Details</strong> – Name, contact info, date of birth, marital status, Aadhar/PAN</li>
        <li><strong>Address Information</strong> – Current and permanent addresses with supporting docs</li>
        <li><strong>Educational Background</strong> – Schooling, graduation, post-grad, certifications</li>
        <li><strong>Employment History</strong> – Job roles, experiences, previous employers</li>
        <li><strong>Medical Information</strong> – Blood group and any medical history (if applicable)</li>
        <li><strong>Background Check Info</strong> – Court/legal proceedings or convictions (if any)</li>
        <li><strong>Bank Details</strong> – For salary disbursement</li>
        <li><strong>Document Uploads</strong> – PAN, Aadhar, address proof, resume, offer letter, etc.</li>
      </ul>
  
      <p>Please ensure all required information is accurate and complete.</p>
  
      <p>Best regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
    `;
  }

  static getCandidateSubmissionEmail(candidate) {
    const submissionDate = new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const statusTitle =
      candidate.status === 'resubmitted'
        ? 'Candidate Information Form Re-Submitted'
        : 'Candidate Information Form Submitted';

    const statusMessage =
      candidate.status === 'resubmitted'
        ? 'The following candidate has re-submitted their Candidate Information Form (CIF):'
        : 'The following candidate has successfully submitted their Candidate Information Form (CIF):';

    return `
    <div>
      <h3>${statusTitle}</h3>

      <p>${statusMessage}</p>

      <ul>
        <li><strong>Name:</strong> ${candidate?.firstName || 'N/A'} ${candidate?.lastName || ''}</li>
        <li><strong>Email:</strong> ${candidate?.personalEmail || 'N/A'}</li>
        <li><strong>Phone:</strong> ${candidate?.phoneNumber || 'N/A'}</li>
        <li><strong>Submission Date:</strong> ${submissionDate}</li>
      </ul>

      <p>You can now begin reviewing their information in the HRMS system.</p>

      <p>Regards,<br/>HRMS System</p>
      
      <p style="font-size: 12px; color: #888;">This is an automated notification.</p>
    </div>
  `;
  }

  static getCandidateResendEmail(candidate, inviteLink, comments, team) {

    const displayTeam = getTeamEmailConfig(team);
    return `
      <p>Dear ${candidate?.firstName},</p>
  
      <p>Our HR team has reviewed your Candidate Information Form (CIF) and has requested some updates. Please access the form using the button below to review the comments and make the necessary changes.</p>
      
      <p><strong>Feedback from HR Team:</strong></p>
      <p>${comments ? comments : "N/A"}</p>


      <p><strong>Please note:</strong> Some fields that have already been verified may be locked and cannot be edited. Please focus on completing the unlocked fields.</p>

      <p>This new link will be valid for <strong>3 days</strong>.</p>
  
      <p>
        <a href="${inviteLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #f0ad4e; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
          Update Your Form
        </a>
      </p>
  
      <p>Thank you for your prompt attention to this matter.</p>
  
      <p>Best regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
    `;
  }

  static getOnboardingPolicyEmail(candidate, policies, team) {
    const displayTeam = getTeamEmailConfig(team);

    // Check if this is specifically a BYOD request
    const isBYOD = policies.some(policy => policy.includes('BYOD'));

    if (isBYOD) {
      return `
        <p>Dear ${candidate.firstName},</p>
        <p>Greeting from ${displayTeam?.TEAM_NAME}</p>
        <p>Please find attached the <strong>Bring Your Own Device (BYOD) Policy</strong> for your review.</p>
        <p>Kindly go through it thoroughly and ensure compliance with the outlined terms.</p>
        <p>We request you to sign the acknowledgment section and share the signed copy with us within the next <strong>24 hours</strong> to proceed further.</p>
        <p>If you have any questions or require clarification regarding the policy, please feel free to reach out.</p>
        <p>Thank you for your cooperation!</p>
        <p>Regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
      `;
    }

    // Fallback to original template for other policies
    const policyList = policies.map(policy => `<li><strong>${policy}</strong></li>`).join('');

    return `
      <p>Hello ${candidate.firstName},</p>
      <p>As part of our onboarding policy, you are required to make arrangements for the following:</p>
      <ul>
        ${policyList}
      </ul>
      <p>Please ensure the required items are available and ready on your joining day.</p>
      <p>If you have any questions or need support, please reach out to the HR team.</p>
      <p>Regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
    `;
  }

  static getCandidateApprovalEmail(candidate, team) {
    const displayTeam = getTeamEmailConfig(team);
    const approvalDate = new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    });

    return `
      <p>Dear ${candidate?.firstName},</p>
      
      <p>Congratulations! We are pleased to inform you that your Candidate Information Form (CIF) has been <strong>approved</strong> by our HR team.</p>
      
      <p><strong>Approval Details:</strong></p>
      <ul>
        <li><strong>Name:</strong> ${candidate?.firstName || 'N/A'} ${candidate?.lastName || ''}</li>
        <li><strong>Email:</strong> ${candidate?.personalEmail || 'N/A'}</li>
        <li><strong>Approval Date:</strong> ${approvalDate}</li>
        <li><strong>Status:</strong> Approved</li>
      </ul>
      
      <p>Your information has been successfully verified and is now part of our official records. You can expect to hear from us soon regarding the next steps in your onboarding process.</p>
      
      <p>If you have any questions or need further assistance, please don't hesitate to contact our HR team.</p>
      
      <p>Welcome to the ${displayTeam?.TEAM_NAME} family!</p>
      
      <p>Best regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
    `;
  }



  static getEmployeeDataRequestEmail(employee, formLink, team, comments = null) {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <p>Dear ${employee?.firstName},</p>

    <p>Hope you're doing well!</p>

    <p>As part of our initiative to streamline and update our records in the HRMS, we kindly request you to complete or verify your employee information by accessing the form below.</p>
    
    ${comments ? `
    <p><strong>Feedback from HR Team:</strong></p>
    <p>${comments}</p>
    ` : ''}

    <p>
      <a href="${formLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #007bff; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
        Update Your Information
      </a>
    </p>

    <p>
      We kindly request you to complete the form <strong>at your earliest convenience</strong> to help us maintain accurate HR records.
    </p>

    <p>You will be asked to verify and, if needed, update the following information:</p>

    <ul>
      <li><strong>Personal Details</strong> – Name, contact information, date of birth, Aadhar/PAN, marital status</li>
      <li><strong>Address Information</strong> – Current and permanent addresses with proof</li>
      <li><strong>Educational Background</strong> – Academic qualifications and certifications</li>
      <li><strong>Employment History</strong> – Previous roles and employers</li>
      <li><strong>Medical Information</strong> – Blood group and health history (if applicable)</li>
      <li><strong>Background Check Information</strong> – Any legal/court proceedings (if any)</li>
      <li><strong>Bank Details</strong> – Required for payroll</li>
      <li><strong>Document Uploads</strong> – PAN, Aadhar, address proof, offer letter, resume, etc.</li>
    </ul>

    <p>We appreciate your cooperation in helping us maintain accurate and up-to-date records.</p>

    <p>Warm regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
  `;
  }

  static getEmployeeDataReminderEmail(employee, formLink, team, comments = null) {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <p>Dear ${employee?.firstName},</p>

    <p>We hope you're doing well.</p>

    <p>This is a reminder to complete your <strong>Candidate Information Form</strong>, as we have not yet received your updated details. Accurate information helps ensure smooth HR and payroll processes.
</p>
    
    ${comments ? `
    <p><strong>Feedback from HR Team:</strong></p>
    <p>${comments}</p>
    ` : ''}

    <p>
      <a href="${formLink}" target="_blank" rel="noopener noreferrer" 
         style="display: inline-block; background-color: #007bff; color: #fff; padding: 12px 20px; 
                border-radius: 6px; text-decoration: none; font-weight: bold;">
        Complete Your Information
      </a>
    </p>

    <p>The form takes just a few minutes to complete. If you have already submitted it, please disregard this message. Otherwise, we would appreciate it if you could update your information at the earliest.</p>

    <p>Thank you for your time and cooperation.</p>

    <p>Warm regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
  `;
  }

  static getEmployeeDataUpdateRequestEmail(employee, formLink, team, comments = null) {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <p>Dear ${employee?.firstName},</p>

    <p>We hope you're doing well!</p>

    <p>Thank you for submitting your Candidate Information Form. After reviewing your submitted information, we need you to make some updates to ensure accuracy and completeness.</p>
    
    ${comments ? `
    <p><strong>Feedback from HR Team:</strong></p>
    <p>${comments}</p>
    ` : ''}

    <p>Please access the form below to review and update the necessary information:</p>

    <p>
      <a href="${formLink}" target="_blank" rel="noopener noreferrer" 
         style="display: inline-block; background-color: #28a745; color: #fff; padding: 12px 20px; 
                border-radius: 6px; text-decoration: none; font-weight: bold;">
        Update Your Information
      </a>
    </p>

    <p><strong>Important:</strong> Please review all sections carefully and make the necessary corrections. Once you've updated the information, please resubmit the form.</p>

    <p>If you have any questions about the required updates or need assistance, please don't hesitate to contact our HR team.</p>

    <p>Thank you for your attention to this matter!</p>

    <p>Warm regards,<br/>HR Team - ${displayTeam?.TEAM_NAME}</p>
  `;
  }




  static dailyAttendanceSummary(userName, date, summaryHtml, team) {
    const displayTeam = getTeamEmailConfig(team);
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #333;">Discrepancy Detected in Your Attendance</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hi <strong>${userName}</strong>,
          </p>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Here is a summary of your attendance for today.
          </p>

          <div style="background-color: #fdf6e3; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
            ${summaryHtml}
          </div>
          <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>HR Team - ${displayTeam?.TEAM_NAME}</strong></p>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated message. Please do not reply directly to this email.
        </div>
      </div>
    `;
  }


  static teamWeeklyReportEmail(teamLeadName, startDate, endDate, tableRows, team) {
    // FIX: All styles are now inline for email client compatibility.
    const containerStyle = "font-family: Arial, sans-serif; auto; color: #333; max-width: 900px;";
    const h1Style = "color: #2a2a2a;";
    const pStyle = "font-size: 16px; line-height: 1.5;";
    const tableStyle = "width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 20px;";
    const thStyle = "border: 1px solid #ddd; padding: 8px; text-align: left; background-color: #9faebeff; font-weight: bold;";

    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="${containerStyle}">
        <p style="${pStyle}">Hi <strong>${teamLeadName}</strong>,</p>
       <p style="${pStyle}">
        Here's your team's attendance overview for the week. 
       </p>

        <table style="${tableStyle}">
            <thead>
                <tr>
                    <th style="${thStyle}">Department</th>
                    <th style="${thStyle}">Employee ID</th>
                    <th style="${thStyle}">Employee Name</th>
                    <th style="${thStyle}">Late Check-Ins</th>
                    <th style="${thStyle}">Early Check-Outs</th>
                    <th style="${thStyle}">No Check-Out</th>
                    <th style="${thStyle}">No Attendance</th>
                    <th style="${thStyle}">Weekly Stats</th>
                    <th style="${thStyle}">Weekly Total Hours</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
        <p style="font-size: 14px; margin-top: 25px;">
  This report has been generated automatically. Kindly review the data and take necessary action on any discrepancies or irregularities in attendance.
</p>
        <p style="color: #777; font-size: 14px;">Regards,<br><strong>HRMS System - ${displayTeam.TEAM_NAME}</strong></p>
    </div>
    `;
  }

  // Enhanced notification templates for granular leave approval workflow

  /**
   * Email template for Team Lead approval notification
   */
  static leaveTLApprovalNotification(userName, date, leaveType, reason, team, jobTitle = 'N/A', employeeId = 'N/A', department = 'N/A', teamLeadName = 'N/A') {
    const displayTeam = getTeamEmailConfig(team);

    // Extract firstName from full name for greeting
    const firstName = userName.split(' ')[0];

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Leave Request - Team Lead Approved</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${firstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Good news! Your Team Lead has approved your leave request. It is now pending final approval from HR.
        </p>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Leave Details</h2>
          
          <!-- Employee Information Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${userName} (${employeeId})</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Department:</strong> ${department}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Team Lead:</strong> ${teamLeadName}</li>
            </ul>
          </div>

          <!-- Leave Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Leave Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${leaveType}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date(s):</strong> ${date}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: #007bff; font-weight: bold;">TL Approved - Pending HR Approval</span></li>
            </ul>
          </div>
        </div>

        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <p style="color: #856404; font-size: 14px; margin: 0;">
            <strong>Next Step:</strong> HR will review and provide final approval for your leave request. You will be notified once a decision is made.
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/leave" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Leave Status
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Support'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for Team Lead rejection notification
   */
  static leaveTLRejectionNotification(userName, date, leaveType, reason, team, isHalfDay = false, halfDayType = null, employeeInfo = null) {
    const displayTeam = getTeamEmailConfig(team);

    // Modify leave type to include half-day information
    let displayLeaveType = leaveType;
    if (isHalfDay) {
      const halfDayText = halfDayType === 'first' ? 'First Half' : 'Second Half';
      displayLeaveType = `${leaveType} (${halfDayText})`;
    }

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Leave Request Rejected by Team Lead</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${firstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          We regret to inform you that your Team Lead has not approved your leave request.
        </p>

        ${employeeInfo ? `
        <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
          </ul>
        </div>
        ` : ''}

        <div style="background-color: #f8d7da; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #dc3545;">
          <h2 style="color: #721c24; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Leave Details</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #721c24; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${displayLeaveType}</li>
            <li style="color: #721c24; margin-bottom: 10px; font-size: 15px;"><strong>Date(s):</strong> ${date}</li>
            <li style="color: #721c24; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
            <li style="color: #721c24; margin-bottom: 10px; font-size: 15px;"><strong>Status:</strong> <span style="color: #dc3545; font-weight: bold;">Rejected by Team Lead</span></li>
          </ul>
        </div>

        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          If you believe this decision needs further discussion, please reach out to your Team Lead or HR for clarification.
        </p>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/leave" style="background-color: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Leave History
          </a>
        </div>


        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for HR final approval notification
   */
  static leaveHRApprovalNotification(userName, date, leaveType, reason, team, isHalfDay = false, halfDayType = null, employeeInfo = null) {
    const displayTeam = getTeamEmailConfig(team);

    // Modify leave type to include half-day information
    let displayLeaveType = leaveType;
    if (isHalfDay) {
      const halfDayText = halfDayType === 'first' ? 'First Half' : 'Second Half';
      displayLeaveType = `${leaveType} (${halfDayText})`;
    }

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Leave Request Approved</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${firstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Excellent news! HR has provided final approval for your leave request. Your leave is now confirmed and active.
        </p>

        ${employeeInfo ? `
        <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
          </ul>
        </div>
        ` : ''}

        <div style="background-color: #d4edda; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #28a745;">
          <h2 style="color: #155724; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Approved Leave Details</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #155724; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${displayLeaveType}</li>
            <li style="color: #155724; margin-bottom: 10px; font-size: 15px;"><strong>Date(s):</strong> ${date}</li>
            <li style="color: #155724; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
            <li style="color: #155724; margin-bottom: 10px; font-size: 15px;"><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">Fully Approved & Active</span></li>
          </ul>
        </div>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <p style="color: #0c5460; font-size: 14px; margin: 0;">
            <strong>Important:</strong> Your attendance has been marked accordingly and leave balance has been updated. Please ensure proper handover of responsibilities.
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/leave" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Leave Details
          </a>
        </div>

          <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for HR rejection notification
   */
  static leaveHRRejectionNotification(userName, date, leaveType, reason, team, isHalfDay = false, halfDayType = null, employeeInfo = null) {
    const displayTeam = getTeamEmailConfig(team);

    // Modify leave type to include half-day information
    let displayLeaveType = leaveType;
    if (isHalfDay) {
      const halfDayText = halfDayType === 'first' ? 'First Half' : 'Second Half';
      displayLeaveType = `${leaveType} (${halfDayText})`;
    }

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Leave Request Rejected by HR</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${firstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          We regret to inform you that HR has not approved your leave request, despite Team Lead approval.
        </p>

        ${employeeInfo ? `
        <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
          </ul>
        </div>
        ` : ''}

        <div style="background-color: #f8d7da; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #dc3545;">
          <h2 style="color: #721c24; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Leave Details</h2>
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${displayLeaveType}</li>
                <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date(s):</strong> ${date}</li>
                <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>
                <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: #dc3545; font-weight: bold;">Rejected by HR</span></li>
              </ul>
            </div>
          </div>

        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          For specific reasons or to discuss this decision, please contact HR directly. They will be able to provide more detailed feedback.
        </p>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/leave" style="background-color: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Leave History
          </a>
        </div>


        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for HR notification when leave needs their approval
   */
  static leaveHRPendingNotification(employeeName, date, leaveType, reason, team, dashboardUrl, isHalfDay = false, halfDayType = null, employeeInfo = null) {
    const displayTeam = getTeamEmailConfig(team);

    // Modify leave type to include half-day information
    let displayLeaveType = leaveType;
    if (isHalfDay) {
      const halfDayText = halfDayType === 'first' ? 'First Half' : 'Second Half';
      displayLeaveType = `${leaveType} (${halfDayText})`;
    }

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Leave Request Pending Your Approval</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Dear HR Team,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          A leave request from <strong>${employeeName}</strong> has been approved by their Team Lead and is now pending your final approval.
        </p>

        ${employeeInfo ? `
        <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Employee Information</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeInfo.employeeId}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Designation:</strong> ${employeeInfo.jobTitle}</li>
            <li style="color: #155724; margin-bottom: 8px; font-size: 14px;"><strong>Department:</strong> ${employeeInfo.department}</li>
          </ul>
        </div>
        ` : ''}

        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <h2 style="color: #856404; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Leave Request Details</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #856404; margin-bottom: 10px; font-size: 15px;"><strong>Employee:</strong> ${employeeName}</li>
            <li style="color: #856404; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${displayLeaveType}</li>
            <li style="color: #856404; margin-bottom: 10px; font-size: 15px;"><strong>Date(s):</strong> ${date}</li>
            <li style="color: #856404; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
            <li style="color: #856404; margin-bottom: 10px; font-size: 15px;"><strong>Current Status:</strong> <span style="color: #007bff; font-weight: bold;">TL Approved - Awaiting HR Approval</span></li>
          </ul>
        </div>

        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Please review the leave request in the HRMS dashboard and provide your final decision.
        </p>

        <div style="text-align: center; margin-top: 30px;">
  <a href="${dashboardUrl}/leave" 
     style="background-color: #ffc107; 
            color: #212529; 
            padding: 12px 28px; 
            text-decoration: none; 
            border-radius: 6px; 
            display: inline-block; 
            font-size: 15px; 
            font-weight: 600; 
            box-shadow: 0 2px 6px rgba(0,0,0,0.15); 
            transition: background-color 0.3s ease;">
    Review Leave Request
  </a>
</div>


        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for regularization notification to Team Lead
   */
  static regularizationNotificationEmail(teamLeadName, employeeFirstName, employeeLastName, date, checkInTime, checkOutTime, reason, type, regularizationId, team = 'SD', employeeId = '', jobTitle = '', department = '') {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>New Regularization Request</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${teamLeadName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          A new regularization request has been submitted by <strong>${employeeFirstName} ${employeeLastName}</strong> and requires your review and approval.
        </p>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <h2 style="color: #0056b3; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Regularization Request Details</h2>
          
          <!-- Employee Information Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${employeeFirstName} ${employeeLastName}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeId || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
            </ul>
          </div>

          <!-- Regularization Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Regularization Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date:</strong> ${date}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-in Time:</strong> ${checkInTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-out Time:</strong> ${checkOutTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${type.charAt(0).toUpperCase() + type.slice(1)} Regularization</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: #ffc107; font-weight: bold;">Pending TL Approval</span></li>
            </ul>
          </div>
        </div>

        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <p style="color: #856404; font-size: 14px; margin: 0;">
            <strong>Action Required:</strong> Please review this regularization request and provide your decision. You can approve or reject the request with appropriate comments.
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/regularization" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            Review Request
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for regularization decision notification to employee
   */
  /**
   * Email template for regularization HR pending notification (to HR)
   */
  static regularizationHRPendingNotification(employeeFirstName, employeeLastName, date, checkInTime, checkOutTime, reason, type, team = 'SD', employeeId = '', jobTitle = '', department = '') {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Regularization Request Pending Your Approval</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Dear HR Team,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          A regularization request from <strong>${employeeFirstName} ${employeeLastName}</strong> has been approved by their Team Lead and is now pending your final approval.
        </p>

        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <h2 style="color: #856404; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Regularization Request Details</h2>
          
          <!-- Employee Information Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee:</strong> ${employeeFirstName} ${employeeLastName}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeId || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
            </ul>
          </div>

          <!-- Regularization Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Regularization Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date:</strong> ${date}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-in Time:</strong> ${checkInTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-out Time:</strong> ${checkOutTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Type:</strong> ${type.charAt(0).toUpperCase() + type.slice(1)} Regularization</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${reason}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Current Status:</strong> <span style="color: #007bff; font-weight: bold;">TL Approved - Awaiting HR Approval</span></li>
            </ul>
          </div>
        </div>

        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Please review the regularization request in the HRMS dashboard and provide your final decision.
        </p>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for regularization decision notification to employee
   */
  static regularizationDecisionEmail(employeeFirstName, reviewerFirstName, reviewerLastName, action, date, checkInTime, checkOutTime, originalReason, rejectionReason = '', team = 'SD', employeeId = '', jobTitle = '', department = '') {
    const displayTeam = getTeamEmailConfig(team);
    const isApproved = action === 'approved';

    // Determine status message based on action
    let statusMessage = '';
    let statusColor = '';

    switch (action) {
      case 'approved':
        statusMessage = 'Fully Approved & Active';
        statusColor = '#28a745';
        break;
      case 'tl-rejected':
        statusMessage = 'Rejected by Team Lead';
        statusColor = '#dc3545';
        break;
      case 'hr-rejected':
        statusMessage = 'Rejected by HR';
        statusColor = '#dc3545';
        break;
      case 'hr-pending':
        statusMessage = 'TL Approved - Pending HR Approval';
        statusColor = '#007bff';
        break;
      case 'tl-pending':
        statusMessage = 'Pending TL Approval';
        statusColor = '#ffc107';
        break;
      case 'revoked':
        statusMessage = 'Revoked';
        statusColor = '#6c757d';
        break;
      default:
        statusMessage = action.charAt(0).toUpperCase() + action.slice(1);
        statusColor = isApproved ? '#28a745' : '#dc3545';
    }

    // Format action for heading
    const formatActionForHeading = (action) => {
      switch (action) {
        case 'tl-rejected':
          return 'Rejected by Team Lead';
        case 'hr-rejected':
          return 'Rejected by HR';
        case 'hr-pending':
          return 'Team Lead Approved';
        case 'tl-pending':
          return 'Pending Team Lead Approval';
        case 'approved':
          return 'Approved';
        case 'revoked':
          return 'Revoked';
        default:
          return action.charAt(0).toUpperCase() + action.slice(1);
      }
    };

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Regularization Request ${formatActionForHeading(action)}</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Dear <strong>${employeeFirstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Your regularization request has been <strong>${action}</strong> by ${reviewerFirstName} ${reviewerLastName}.
        </p>

        <div style="background-color: ${isApproved ? '#d4edda' : '#f8d7da'}; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid ${statusColor};">
          <h2 style="color: ${isApproved ? '#155724' : '#721c24'}; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Regularization Request Details</h2>
          
          <!-- Employee Information Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee ID:</strong> ${employeeId || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Designation:</strong> ${jobTitle || 'N/A'}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Department:</strong> ${department || 'N/A'}</li>
            </ul>
          </div>

          <!-- Regularization Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Regularization Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Date:</strong> ${date}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-in Time:</strong> ${checkInTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Requested Check-out Time:</strong> ${checkOutTime}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Reason:</strong> ${originalReason}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusMessage}</span></li>
            </ul>
          </div>
        </div>

        ${!isApproved && rejectionReason ? `
        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; font-size: 16px; margin-top: 0; margin-bottom: 10px;">Rejection Reason</h3>
          <p style="color: #856404; font-size: 14px; line-height: 1.5; margin: 0;">${rejectionReason}</p>
        </div>
        ` : ''}

        ${action === 'hr-pending' ? `
        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <p style="color: #856404; font-size: 14px; margin: 0;">
            <strong>Next Step:</strong> HR will review and provide final approval for your regularization request. You will be notified once a decision is made.
          </p>
        </div>
        ` : action === 'approved' ? `
        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <p style="color: #0c5460; font-size: 14px; margin: 0;">
            <strong>Important:</strong> Your attendance record has been updated with the corrected times. The changes will be reflected in your attendance history.
          </p>
        </div>
        ` : `
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          If you have any questions about this decision, please contact your Team Lead or HR department for clarification.
        </p>
        `}

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/regularization" style="background-color: ${isApproved ? '#28a745' : '#6c757d'}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Regularization History
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for regularization revoked notification
   */
  static regularizationRevokedEmail(employeeFirstName, date, checkInTime, checkOutTime, reason, team = 'SD') {
    const displayTeam = getTeamEmailConfig(team);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1>Regularization Request Revoked</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${employeeFirstName}</strong>,
        </p>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Your regularization request has been <strong style="color: #6c757d;">revoked</strong> by you.
        </p>

        <div style="background-color: #f8f9fa; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #6c757d;">
          <h2 style="color: #495057; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Revoked Regularization Details</h2>
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="color: #495057; margin-bottom: 10px; font-size: 15px;"><strong>Date:</strong> ${date}</li>
            <li style="color: #495057; margin-bottom: 10px; font-size: 15px;"><strong>Requested Check-in Time:</strong> ${checkInTime}</li>
            <li style="color: #495057; margin-bottom: 10px; font-size: 15px;"><strong>Requested Check-out Time:</strong> ${checkOutTime}</li>
            <li style="color: #495057; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
            <li style="color: #495057; margin-bottom: 0; font-size: 15px;"><strong>Status:</strong> <span style="color: #6c757d; font-weight: bold;">Revoked</span></li>
          </ul>
        </div>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <p style="color: #0c5460; font-size: 14px; margin: 0;">
            <strong>Note:</strong> The regularization request has been cancelled. If you need to submit a new regularization request, you can do so through the HRMS system.
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.HRMS_FRONTEND_URL}/regularization" style="background-color: #6c757d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            View Regularization History
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Email template for asset request status update notification
   */
  static getAssetRequestStatusEmail(firstName, employeeId, assetType, specifications, status, dashboardUrl) {
    const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #fdfdfd;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #333; font-size: 22px;">Asset Request <span style="color: ${statusColor};">${capitalizedStatus}</span></h2>
      </div>

      <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
        <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
          Hello <strong>${firstName}</strong>,
        </p>

        <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
          Your asset request has been 
          <strong style="color: ${statusColor};">${capitalizedStatus}</strong>. Below are the request details:
        </p>

        <table style="width: 100%; font-size: 14px; color: #555; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0;"><strong>Employee ID:</strong></td>
            <td style="padding: 8px 0;">${employeeId}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;"><strong>Asset Type:</strong></td>
            <td style="padding: 8px 0;">${assetType}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;"><strong>Specifications:</strong></td>
            <td style="padding: 8px 0;">${specifications}</td>
          </tr>
        </table>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}" style="background-color: #007bff; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            View Request in Dashboard
          </a>
        </div>

        <p style="font-size: 14px; color: #777; line-height: 1.5; margin-bottom: 24px;">
          If you have any questions or concerns, please feel free to contact the IT department.
        </p>

        <p style="font-size: 15px; color: #555; line-height: 1.6; margin-bottom: 8px;">
          Thanks & regards,<br>
          <strong>IT Department</strong>
        </p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
    `;
  }

  /**
   * Email template for asset request notification
   */
  static getAssetRequestEmail(employeeName, employeeId, assetType, specifications, neededBy, description, dashboardUrl, team) {
    const displayTeam = getTeamEmailConfig(team);
    const formattedDate = new Date(neededBy).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #333;">New Asset Request</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello Team,</p>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          A new asset request has been submitted by an employee. Please review the details below:
        </p>

        <div style="background-color: #e7f3ff; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #007bff;">
          <h2 style="color: #0056b3; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Asset Request Details</h2>
          
          <!-- Employee Information Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Employee Information</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Employee Name:</strong> ${employeeName}</li>
              <li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Employee ID:</strong> ${employeeId}</li>
            </ul>
          </div>

          <!-- Asset Request Details Section -->
          <div style="background-color: #ffffff; padding: 16px 20px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 20px;">
            <h3 style="color: #495057; font-size: 15px; margin: 0 0 10px 0; font-weight: 600;">Asset Request Details</h3>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Asset Type:</strong> ${assetType}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Specifications:</strong> ${specifications}</li>
              <li style="color: #495057; margin-bottom: 10px; font-size: 14px;"><strong>Needed By:</strong> ${formattedDate}</li>
              ${description ? `<li style="color: #495057; margin-bottom: 0; font-size: 14px;"><strong>Description:</strong> ${description}</li>` : ''}
            </ul>
          </div>
        </div>

        <div style="background-color: #fff3cd; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <p style="color: #856404; font-size: 14px; margin: 0;">
            <strong>Action Required:</strong> Please review this asset request and take appropriate action. You can approve or reject the request with comments.
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px;">
          <a href="${dashboardUrl}/assets/requests" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;">
            Review Asset Request
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${displayTeam?.TEAM_NAME}</strong></p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from the ${displayTeam?.TEAM_NAME || 'Company'} HRMS System. Please do not reply to this email.
      </p>
    </div>
    `;
  }

  /**
   * Get Birthday Email Template
   * @param {Object} user - User object with firstName, lastName, employeeId
   * @param {Object} department - Department object with name
   * @param {string} team - User team (SD or KAP)
   * @returns {string} HTML template for birthday email
   */
  static getBirthdayEmailTemplate(user, department, team) {
    const displayTeam = getTeamEmailConfig(team);
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="color: #333; font-size: 28px; margin-bottom: 30px;">Happy Birthday, ${user.firstName} ${user.lastName} 🎂</h1>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">On this special day, the ${displayTeam?.TEAM_NAME || 'KollegeApply'} family celebrates you</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">Your energy, your passion, and the strength you bring to the team</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">every single day.</p>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Employee ID : ${user.employeeId}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 20px;"><strong>Department : ${department?.name || 'N/A'}</strong></p>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;">Happy Birthday once again from all of us at ${displayTeam?.TEAM_NAME || 'KollegeApply'}!</p>
        </div>
        
        <div style="text-align: center;">
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>With Strength & Warmth,</strong></p>
          <p style="color: #333; font-size: 16px;"><strong>Team ${displayTeam?.TEAM_NAME || 'KollegeApply'}</strong></p>
        </div>
      </div>
    `;
  }

  /**
   * Get Work Anniversary Email Template
   * @param {Object} user - User object with firstName, lastName, employeeId
   * @param {Object} department - Department object with name
   * @param {number} yearsOfService - Number of years of service
   * @param {string} yearText - 'year' or 'years'
   * @param {Date} today - Today's date
   * @param {string} team - User team (SD or KAP)
   * @returns {string} HTML template for work anniversary email
   */
  static getWorkAnniversaryEmailTemplate(user, department, yearsOfService, yearText, today, team) {
    const displayTeam = getTeamEmailConfig(team);
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; font-size: 24px; margin-bottom: 20px;">Another Year of Excellence🏆 with ${displayTeam?.TEAM_NAME || 'KollegeApply'} !</h1>
          <h2 style="color: #333; font-size: 20px; margin-bottom: 30px;">⭐Congratulations ${user.firstName} ${user.lastName}⭐</h2>
        </div>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="color: #333; font-size: 18px; margin-bottom: 10px; font-weight: bold;">Today marks a special milestone</p>
          <p style="color: #333; font-size: 18px; margin-bottom: 30px; font-weight: bold;">Your ${yearsOfService}${yearsOfService === 1 ? 'st' : yearsOfService === 2 ? 'nd' : yearsOfService === 3 ? 'rd' : 'th'} Work Anniversary with ${displayTeam?.TEAM_NAME || 'KollegeApply'} !</p>
        </div>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Your journey as ${user.jobTitle || 'team member'} has been inspiring. Your dedication, teamwork, &</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">valuable contributions have played an important role in our growth.</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">We truly appreciate your hard work and commitment.</p>
        </div>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Employee ID : ${user.employeeId}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Employee Name : ${user.firstName} ${user.lastName}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Department : ${department?.name || 'N/A'}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;"><strong>Workiversary : ${yearsOfService} ${yearText}</strong></p>
        </div>
        
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;">Thank you for being an integral part of the ${displayTeam?.TEAM_NAME || 'KollegeApply'} family.</p>
          <p style="color: #333; font-size: 16px;">Here's to many more years of success, growth, & shared achievements together!</p>
        </div>
      </div>
    `;
  }

  /**
   * Get Marriage Anniversary Email Template
   * @param {Object} user - User object with firstName, lastName, employeeId
   * @param {string} departmentName - Department name
   * @param {number} yearsOfMarriage - Number of years married
   * @param {string} yearText - 'year' or 'years'
   * @param {string} spouseName - Spouse name (optional)
   * @param {Date} today - Today's date
   * @param {string} team - User team (SD or KAP)
   * @returns {string} HTML template for marriage anniversary email
   */
  static getMarriageAnniversaryEmailTemplate(user, departmentName, yearsOfMarriage, yearText, spouseName, today, team) {
    const displayTeam = getTeamEmailConfig(team);
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f5f5f5; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="color: #333; font-size: 24px; margin-bottom: 30px;">Happy Marriage Anniversary, ${user.firstName} ${user.lastName} 💑</h1>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">On behalf of the ${displayTeam?.TEAM_NAME || 'KollegeApply'} Team, we warmly congratulate you and</p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">your spouse on completing your ${yearsOfMarriage === 1 ? 'first year' : `${yearsOfMarriage} ${yearText}`} of marriage !</p>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Employee ID : ${user.employeeId}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>Employee Name : ${user.firstName} ${user.lastName}</strong></p>
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;"><strong>Department : ${departmentName || 'N/A'}</strong></p>
        </div>
        
        <div style="text-align: center; margin-bottom: 40px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;">🌹Wishing you a journey of love, strength, and togetherness for many</p>
          <p style="color: #333; font-size: 16px; margin-bottom: 30px;">more years to come🌹</p>
        </div>
        
        <div style="text-align: center;">
          <p style="color: #333; font-size: 16px; margin-bottom: 5px;"><strong>With Warm Regards,</strong></p>
          <p style="color: #333; font-size: 16px;"><strong>Team ${displayTeam?.TEAM_NAME || 'KollegeApply'}</strong></p>
        </div>
      </div>
    `;
  }

  // 📧 STL APPROVAL EMAIL TEMPLATES

  /**
   * Email template for TL when STL feedback needs approval
   */
  static getSTLApprovalEmail({ stlUser, employee, tlUser, dashboardUrl, feedbackId, team }) {
    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">STL Feedback Pending Your Approval</h2>
      </div>

      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hello <strong>${tlUser?.firstName} ${tlUser?.lastName}</strong>,
        </p>
        
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          <strong>${stlUser?.firstName} ${stlUser?.lastName}</strong> (Sub Team Lead) has submitted feedback for 
          <strong>${employee?.firstName} ${employee?.lastName}</strong> (${employee?.employeeId}) that requires your approval.
        </p>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #fbbf24;">
          <h3 style="color: #333; margin: 0 0 10px 0;">Action Required</h3>
          <p style="color: #555; margin: 0; font-size: 14px;">
            Please review and approve/reject this feedback before it's delivered to the employee.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks?tab=stl-approvals" 
             style="background-color: #101E2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Review STL Feedback
          </a>
        </div>

        <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="color: #888; font-size: 14px; line-height: 1.5;">
            Best regards,<br>
            <strong>${displayTeam?.TEAM_NAME || 'HRMS'} Team</strong>
          </p>
        </div>
      </div>
    </div>
    `;
  }

  /**
   * Email template for employee when STL feedback is approved
   */
  static getFeedbackApprovedEmail({ stlUser, employee, tlUser, feedback, dashboardUrl, feedbackId, team }) {
    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">New Feedback Received</h2>
      </div>

      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hello <strong>${employee?.firstName} ${employee?.lastName}</strong>,
        </p>
        
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You have received feedback from <strong>${stlUser?.firstName} ${stlUser?.lastName}</strong> (Sub Team Lead), 
          which has been reviewed and approved by <strong>${tlUser?.firstName} ${tlUser?.lastName}</strong> (Team Lead).
        </p>

        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #3b82f6;">
          <h3 style="color: #333; margin: 0 0 10px 0;">Feedback Details</h3>
          <p style="color: #555; margin: 0; font-size: 14px;">
            Period: ${new Date(feedback.from).toLocaleDateString()} - ${new Date(feedback.to).toLocaleDateString()}
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks/view/${feedbackId}" 
             style="background-color: #101E2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View Your Feedback
          </a>
        </div>

        <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="color: #888; font-size: 14px; line-height: 1.5;">
            Best regards,<br>
            <strong>${displayTeam?.TEAM_NAME || 'HRMS'} Team</strong>
          </p>
        </div>
      </div>
    </div>
    `;
  }

  /**
   * Email template for STL when feedback is rejected
   */
  static getFeedbackRejectedEmail({ stlUser, employee, tlUser, comments, dashboardUrl, team }) {
    const displayTeam = getTeamEmailConfig(team);
    return `
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">Feedback Rejected</h2>
      </div>

      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hello <strong>${stlUser?.firstName} ${stlUser?.lastName}</strong>,
        </p>
        
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Your feedback for <strong>${employee?.firstName} ${employee?.lastName}</strong> (${employee?.employeeId}) 
          has been reviewed by <strong>${tlUser?.firstName} ${tlUser?.lastName}</strong> (Team Lead) and was not approved.
        </p>

        <div style="background-color: #fef2f2; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ef4444;">
          <h3 style="color: #333; margin: 0 0 10px 0;">Rejection Reason</h3>
          <p style="color: #555; margin: 0; font-size: 14px;">
            ${comments}
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${dashboardUrl}/feedbacks" 
             style="background-color: #101E2F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View Feedback Dashboard
          </a>
        </div>

        <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="color: #888; font-size: 14px; line-height: 1.5;">
            Best regards,<br>
            <strong>${displayTeam?.TEAM_NAME || 'HRMS'} Team</strong>
          </p>
        </div>
      </div>
    </div>
    `;
  }
}

module.exports = Helper;
