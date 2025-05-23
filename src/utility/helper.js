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
  static async sendEmail({ receiverEmails, subject, message, fromHr = false }) {
    if (!MAIL_USER || !MAIL_PASS) {
      logger.error(
        'SMTP credentials (MAIL_USER, MAIL_PASS) are not configured. Cannot send email.'
      );
      return; // Or throw an error
    }

    const transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: MAIL_SECURE, // Use true for 465, false for other ports like 587
      ...(MAIL_SERVICE && { service: MAIL_SERVICE }), // Add service if defined
      auth: {
        user: fromHr ? HR_MAIL_USER : MAIL_USER,
        pass: fromHr ? HR_MAIL_PASS : MAIL_PASS,
      },
    });

    const mailOptions = {
      from: fromHr
        ? `"HR" <${MAIL_FROM_HR}>`
        : `"Support" <${MAIL_FROM_SUPPORT}>`,
      to: receiverEmails.join(','),
      subject: subject,
      html: message,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      logger.info('Email sent successfully:', info.messageId);
    } catch (error) {
      logger.error('Failed to send email:', error);
      // Consider re-throwing or handling the error based on application needs
      // throw new Error('Failed to send email');
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
  
        <div style="background-color: #ffecec; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #d9534f;">
          <h2 style="color: #b52b27; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Reason Provided</h2>
          <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0;">
            ${reason}
          </p>
        </div>
  
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

  /**
   * Generates an asset assignment email template for IT department.
   * @param {string} firstName - Employee's first name.
   * @param {string} assetName - The name of the asset assigned.
   * @param {string} assetId - The ID of the asset.
   * @param {string} serialNumber - The serial number of the asset (if available).
   * @param {string} assignedBy - The name of the person who assigned the asset.
   * @returns {string} - HTML email content.
   */
  /**
   * Generates an asset assignment email for employees.
   * @param {string} firstName - Employee's first name.
   * @param {string} assetName - Name of the assigned asset.
   * @param {string} assetId - Asset ID.
   * @param {string} loginUrl - URL to the HRMS dashboard.
   * @returns {string} - HTML email content.
   */
  static getAssetAssignmentEmail(firstName, assetName, assetId, loginUrl) {
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
      You have been assigned a new asset: <strong>${assetName}</strong> (Asset ID: ${assetId}).
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

  /**
   * Generates an email template for asset acknowledgment notification.
   * @param {string} employeeName - The name of the employee.
   * @param {string} employeeId - The employee ID.
   * @param {string} assetName - The asset name.
   * @param {string} assetId - The asset ID.
   * @param {string} dashboardUrl - The HRMS dashboard URL.
   * @returns {string} - HTML email content.
   */
  static getAssetAcknowledgmentEmail(
    employeeName,
    employeeId,
    assetName,
    assetId,
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
        <strong>Asset ID:</strong> ${assetId}
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

  /**
   * Generates an email template for asset rejection notification.
   * @param {string} employeeName - The name of the employee.
   * @param {string} employeeId - The employee ID.
   * @param {string} assetName - The asset name.
   * @param {string} assetId - The asset ID.
   * @param {string} dashboardUrl - The HRMS dashboard URL.
   * @returns {string} - HTML email content.
   */
  static getAssetRejectionEmail(
    employeeName,
    employeeId,
    assetName,
    assetId,
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
        <strong>Asset ID:</strong> ${assetId}
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
}

module.exports = Helper;
