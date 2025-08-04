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

  static leaveWFHApproval(userName, requestType, date, leaveType = '', reason) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">${requestType} Request Approved</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Hi <strong>${userName}</strong>,
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Your <strong>${requestType}</strong> request on <strong>${date}</strong> has been approved.
    </p>

    <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
      <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Request Details</h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${requestType === 'Leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Date:</strong> ${date}</li>
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
      </ul>
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

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${process?.env?.TEAM}</strong></p>
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
    reason = ''
  ) {
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
  
          <div style="background-color: #ffecec; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ff4c4c;">
            <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Revocation Details</h2>
            <ul style="list-style: none; padding: 0; margin: 0;">
              ${requestType === 'Leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Leave Type:</strong> ${leaveType}</li>` : ''}
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Date(s):</strong> ${Array.isArray(date) ? date.join(', ') : date}</li>
              ${reason ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>` : ''}
            </ul>
          </div>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Please make note of the change and adjust any responsibilities or schedules accordingly.
          </p>
  
          <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${process?.env?.TEAM}</strong></p>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated message. Please do not reply directly to this email.
        </div>
      </div>
    `;
  }

  static fullTimeConversion(userName, date, jobTitle, team) {
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
    requestType,
    leaveType = '',
    fromDate,
    toDate,
    reason,
    dashboardUrl
  }) {
     const fromMoment = moment(fromDate).tz('Asia/Kolkata');
     const toMoment = moment(toDate).tz('Asia/Kolkata');


    let leaveMessage = '';

    if (fromMoment.isSame(toMoment, 'day')) {
      leaveMessage = `${fromMoment.format('DD MMMM YYYY')}`;
    } else {
      leaveMessage = `${fromMoment.format('DD MMMM YYYY')} to ${toMoment.format('DD MMMM YYYY')}`;
    }

    return `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #333;">${requestType} Request Notification</h2>
        </div>
  
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hello Team,
          </p>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            <strong>${userName}</strong> has requested for <strong>${requestType}</strong> for the following period:
          </p>
  
          <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
            <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Request Details</h2>
            <ul style="list-style: none; padding: 0; margin: 0;">
              ${requestType === 'Leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Date:</strong> ${leaveMessage}</li>
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
              <li style="margin: 30px 0;">
           <a href="${dashboardUrl}/leave" 
   style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); text-align: center; transition: background-color 0.3s ease;">
  Take Action
</a>
            </li>
            </ul>
          </div>
  
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Kindly review and take necessary actions.
          </p>
  
          <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>${process?.env?.TEAM} Support Team</strong></p>
        </div>
  
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated notification. Please do not reply to this email directly.
        </div>
      </div>
    `;
  }

  static leaveWFHReject(userName, requestType, date, leaveType, reason) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #d9534f;">${requestType} Request Declined</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          Hi <strong>${userName}</strong>,
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


  static getAssetReturnRequestEmail(firstName, employeeId, assetName, assetType, dashboardUrl) {
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
          <p style="color: #555; font-size: 15px;">
            <strong>Employee Name:</strong> ${firstName}<br>
            <strong>Employee ID:</strong> ${employeeId}<br>
            <strong>Asset Name:</strong> ${assetName}<br>
            <strong>Asset Type:</strong> ${assetType}
          </p>
        </div>

        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You can review and process the request in the <a href="${dashboardUrl}/assets" style="color: #007bff;">HRMS dashboard</a>.
        </p>

        <p style="color: #999; font-size: 14px;">This is an automated email. Please do not reply.</p>
      </div>
    </div>
  `;
  }



  static getAssetAssignmentEmail(firstName, assetName, assetType, loginUrl,team) {
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
    dashboardUrl
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
      <p style="color: #555; font-size: 15px;">
        <strong>Employee Name:</strong> ${employeeName}<br>
        <strong>Employee ID:</strong> ${employeeId}<br>
        <strong>Asset Name:</strong> ${assetName}<br>
        <strong>Asset Type:</strong> ${assetType}
      </p>
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

 static getAssetReturnStatusEmail(firstName, employeeId, assetName, assetType, status, dashboardUrl) {
  const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
  const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #fdfdfd;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #333; font-size: 22px;">Asset Return Request <span style="color: ${statusColor};">${capitalizedStatus}</span></h2>
    </div>

    <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
        Hello <strong>${firstName}</strong>,
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
        Your asset return request has been 
        <strong style="color: ${statusColor};">${capitalizedStatus}</strong>. Below are the request details:
      </p>

      <table style="width: 100%; font-size: 14px; color: #555; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Employee ID:</strong></td>
          <td style="padding: 8px 0;">${employeeId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Name:</strong></td>
          <td style="padding: 8px 0;">${assetName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Type:</strong></td>
          <td style="padding: 8px 0;">${assetType}</td>
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



static getAssetRejectionEmail(
  employeeName,
  employeeId,
  assetName,
  assetType,
  dashboardUrl
) {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #dc3545; font-size: 22px;">🚫 Asset Rejection Notification</h2>
    </div>

    <div style="background-color: #fff; padding: 28px 24px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; line-height: 1.5; margin-bottom: 16px;">
        Hello Team,
      </p>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 16px;">
        The following asset has been <strong>rejected</strong> by the employee:
      </p>

      <table style="width: 100%; font-size: 14px; color: #555; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Employee Name:</strong></td>
          <td style="padding: 8px 0;">${employeeName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Employee ID:</strong></td>
          <td style="padding: 8px 0;">${employeeId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Name:</strong></td>
          <td style="padding: 8px 0;">${assetName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Type:</strong></td>
          <td style="padding: 8px 0;">${assetType}</td>
        </tr>
      </table>

      <p style="font-size: 15px; color: #555; line-height: 1.5; margin-bottom: 20px;">
        You can review this rejection in the dashboard below:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${dashboardUrl}" style="background-color: #dc3545; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
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



static getAssetReceivedConfirmationEmail(firstName, employeeId, assetName, assetType, dashboardUrl) {
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

      <table style="width: 100%; font-size: 14px; color: #555; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Employee Name:</strong></td>
          <td style="padding: 8px 0;">${firstName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Employee ID:</strong></td>
          <td style="padding: 8px 0;">${employeeId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Name:</strong></td>
          <td style="padding: 8px 0;">${assetName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Asset Type:</strong></td>
          <td style="padding: 8px 0;">${assetType}</td>
        </tr>
      </table>

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


static getTicketStatusUpdateEmail(employeeName, subject, status, baseUrl, ticketId, teamName) {
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

        <div style="text-align: center; margin: 30px 0;">
          <a href="${baseUrl}/tickets" target="_blank" rel="noopener noreferrer"
             style="background-color: #007bff; color: white; padding: 12px 24px; border-radius: 5px; text-decoration: none; font-weight: bold;">
            View Ticket in Dashboard
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
  
      <p>Welcome aboard! We're excited to have you as part of the Sportsdunia family.</p>
  
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
      
      <p><strong>Comments from HR:</strong></p>
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

}

module.exports = Helper;
