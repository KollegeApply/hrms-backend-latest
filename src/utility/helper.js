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
} = require('./constants');
const { OTP_EXPIRY_MINUTES } = require('./constants');
const { formatDateToKolkata } = require('./common');

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
  }) {
    if (!MAIL_USER || !MAIL_PASS) {
      logger.error(
        'SMTP credentials (MAIL_USER, MAIL_PASS) are not configured. Cannot send email.'
      );
      return;
    }

    // Determine sender credentials and "from" label
    let user = MAIL_USER;
    let pass = MAIL_PASS;
    let from = `"Support" <${MAIL_FROM_SUPPORT}>`;

    if (fromHR) {
      user = HR_MAIL_USER;
      pass = HR_MAIL_PASS;
      from = `"HR Department" <${MAIL_FROM_HR}>`;
    } else if (fromIT) {
      user = IT_MAIL_USER;
      pass = IT_MAIL_PASS;
      from = `"IT Department" <${MAIL_FROM_IT}>`;
    }

    const transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: MAIL_SECURE,
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
      logger.info('Email sent successfully:', info.messageId);
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
  static getWelcomeEmail(firstName, userEmail, password, loginUrl) {
    // SECURITY NOTE: Sending passwords via email is generally discouraged.
    // Consider sending a password reset link instead.
    // This template includes the password as requested based on the LMS example.
    return `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">Welcome to ${process?.env?.TEAM}!</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">Hi <strong>${firstName}</strong>,</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Welcome aboard! We're excited to have you as part of the <strong>${process?.env?.TEAM}</strong> family.
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
      <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Login to ${process?.env?.TEAM}</a>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      Welcome again, and let’s get started!
    </p>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Cheers!<br><strong>Team ${process?.env?.TEAM}</strong></p>
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
        ${requestType === 'leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
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
              ${requestType === 'leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Leave Type:</strong> ${leaveType}</li>` : ''}
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

  static fullTimeConversion(userName, date, jobTitle) {
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
      It is with pleasure that we confirm your transition to full-time employment with <strong>${process?.env?.TEAM}</strong>, effective from <strong>${date}</strong>.
    </p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      We are delighted with your performance during the probation period and excited to have you as a full-time member of our team.
    </p>

    <div style="background-color: #eaffea; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #28a745;">
      <h2 style="color: #2f8132; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Your Confirmation Details</h2>
      <ul style="list-style: none; padding: 0; margin: 0;">
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Job Title:</strong> ${jobTitle}</li>
        <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Employment Status:</strong> Confirmed Full-Time</li>
        <li style="color: #555; font-size: 15px;"><strong>Effective Date:</strong> ${date}</li>
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

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Team ${process?.env?.TEAM}</strong></p>
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
  }) {
    // Format the dates for the email
    const fromFormatted = formatDateToKolkata(fromDate);
    const toFormatted = formatDateToKolkata(toDate);

    let leaveMessage = '';

    if (leaveType) {
      // If leave is for a single day
      if (fromDate.toDateString() === toDate.toDateString()) {
        leaveMessage = `Leave applied for: ${fromFormatted}`;
      }
      // If leave is for multiple days
      else {
        leaveMessage = `Leave applied from ${fromFormatted} to ${toFormatted}`;
      }
    } else {
      leaveMessage = `${fromFormatted}`;
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
              ${requestType === 'leave' ? `<li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Type:</strong> ${leaveType}</li>` : ''}
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Date:</strong> ${leaveMessage}</li>
              <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Reason:</strong> ${reason}</li>
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
          You can review and process the request in the <a href="${dashboardUrl}/assets/returns" style="color: #007bff;">HRMS dashboard</a>.
        </p>

        <p style="color: #999; font-size: 14px;">This is an automated email. Please do not reply.</p>
      </div>
    </div>
  `;
  }



  static getAssetAssignmentEmail(firstName, assetName, assetType, loginUrl) {
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
      <a href="${loginUrl}" style="background-color: #007bff; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Go to Dashboard</a>
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
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: #333;">Asset Return Request ${capitalizedStatus}</h1>
    </div>
    <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
      <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello <strong>${firstName}</strong>,</p>
      <p style="color: #555; font-size: 16px; line-height: 1.6;">
        Your return request for the following asset has been 
        <strong style="color: ${statusColor};">${capitalizedStatus}</strong>:
      </p>
      <p style="color: #555; font-size: 16px; line-height: 1.6;">
        <strong>Employee ID:</strong> ${employeeId}<br>
        <strong>Asset Name:</strong> ${assetName}<br>
        <strong>Asset Type:</strong> ${assetType}
      </p>
       <div style="text-align: center; margin: 30px 0;">
        You can view the request status by visiting your dashboard: <br>
        <a href="${dashboardUrl}/assets/assigned" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">View Asset Details</a>
       </div>
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
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #333;">Asset Rejection Notification</h1>
  </div>
  <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello Team,</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      The following asset has been rejected by the employee:
    </p>

    <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #f00;">
      <p style="color: #555; font-size: 15px;">
        <strong>Employee Name:</strong> ${employeeName}<br>
        <strong>Employee ID:</strong> ${employeeId}<br>
        <strong>Asset Name:</strong> ${assetName}<br>
        <strong>Asset Type:</strong> ${assetType}
      </p>
    </div>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You can review the asset rejection in the dashboard.
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${dashboardUrl}/assets/assigned" style="background-color: #dc3545; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">View Rejected Asset</a>
    </div>

    <p style="color: #777; font-size: 14px; line-height: 1.5;">Thank you,<br>IT Department</p>
  </div>
  <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
    This is an automated message. Please do not reply directly to this email.
  </div>
</div>
  `;
  }


  static getAssetReceivedConfirmationEmail(firstName, employeeId, assetName, assetType, dashboardUrl) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #333;">Asset Received Confirmation</h1>
      </div>
      <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
        <p style="color: #555; font-size: 16px; line-height: 1.6;">Hello Team,</p>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          The following asset has been successfully returned and received from the employee:
        </p>
        <ul style="color: #555; font-size: 16px; line-height: 1.6; list-style: none; padding-left: 0;">
          <li><strong>Employee Name:</strong> ${firstName}</li>
          <li><strong>Employee ID:</strong> ${employeeId}</li>
          <li><strong>Asset Name:</strong> ${assetName}</li>
          <li><strong>Asset Type:</strong> ${assetType}</li>
        </ul>
        <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You can review the record in the <a href="${dashboardUrl}" style="color: #007bff;">HRMS dashboard</a>.
        </p>
        <p style="color: #999; font-size: 14px;">This is an automated email. Please do not reply.</p>
      </div>
    </div>
  `;
  }

  static getFeedbackEmail({ givenByUser, givenToUser, dashboardUrl, feedbackId }) {
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
          <a href="${dashboardUrl}/feedback/view/${feedbackId}" 
             style="display: inline-block; background-color: #4CAF50; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Feedback
          </a>
        </div>

        <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>${process?.env?.TEAM || 'HRMS'} Support Team</strong></p>
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
  }) {
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
          <a href="${dashboardUrl}/feedback/view/${feedbackId}" style="color: #dc2626; text-decoration: none;">Click here to view the feedback</a>.
        </p>

        <p style="color: #777; font-size: 14px; margin-top: 30px;">
          Best regards,<br><strong>${process?.env?.TEAM || 'HRMS'} Support Team</strong>
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
  }) {
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
          <a href="${dashboardUrl}/feedback/approve-edit/${feedbackId}" 
             style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            Review Edit Request
          </a>
        </div>

        <p style="color: #666; font-size: 14px;">Thank you,<br><strong>${process?.env?.TEAM || 'HRMS'} Support Team</strong></p>
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
    feedbackId
  }) {
    const isApproved = status === 'approved';
    const subjectText = isApproved ? 'approved' : 'rejected';
    const color = isApproved ? '#16a34a' : '#dc2626';

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
          <a href="${dashboardUrl}/feedback/view/${feedbackId}" 
             style="display: inline-block; background-color: ${color}; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Feedback
          </a>
        </div>

        <p style="color: #777; font-size: 14px;">Best regards,<br><strong>${process?.env?.TEAM || 'HRMS'} Support Team</strong></p>
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
  }) {
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
          <a href="${dashboardUrl}/feedback/view/${feedbackId}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-size: 15px;">
            View Updated Feedback
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px;">
          Best regards,<br><strong>${process?.env?.TEAM || 'HRMS'} Support Team</strong>
        </p>
      </div>

      <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #9ca3af;">
        This is an automated message. Please do not reply directly to this email.
      </div>
    </div>
  `;
  }




  static getTicketCreatedEmailForTeam(subject, type, raisedByName, baseUrl, ticketId) {
    return `
    <p>Hello Team,</p>
    <p>A new <strong>${type}</strong> ticket has been raised by ${raisedByName}.</p>
    <p><strong>Subject:</strong> ${subject}</p>

    <p style="color: #555; font-size: 16px; line-height: 1.6;">
          You can review the record in the <a href="${baseUrl}/tickets" style="color: #007bff;">HRMS DASHBOARD</a>.
    </p>
        

     <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>${process?.env?.TEAM} Support Team</strong></p>
  `;
  }

  static getTicketStatusUpdateEmail(employeeName, subject, status, baseUrl, ticketId) {
    return `
    <p>Hi ${employeeName},</p>
    <p>Your ticket regarding <strong>${subject}</strong> has been <strong>${status}</strong>.</p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
      You can review the record in the 
      <a href="${baseUrl}/tickets" target="_blank" rel="noopener noreferrer" style="color: #007bff;">
        HRMS Dashboard
      </a>.
    </p>
    <p>If you need further assistance, please contact your HR or support team.</p>
  `;
  }

  static getCandidateInviteEmail(candidate, inviteLink) {
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
  
      <p>Best regards,<br/>HR Team - Sportsdunia</p>
    `;
  }
  
}

module.exports = Helper;
