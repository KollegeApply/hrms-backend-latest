// src/utility/helper.js
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
const {
  MAIL_HOST,
  MAIL_PORT,
  MAIL_SECURE,
  MAIL_SERVICE,
  MAIL_FROM,
  MAIL_USER,
  MAIL_PASS,
} = require('./constants');
const { OTP_EXPIRY_MINUTES } = require('./constants');

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
  static async sendEmail({ receiverEmails, subject, message }) {
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
        user: MAIL_USER,
        pass: MAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Your Company HR" <${MAIL_FROM}>`, // Customize sender name
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
  static getWelcomeEmail(name, userEmail, role, password, loginUrl) {
    // SECURITY NOTE: Sending passwords via email is generally discouraged.
    // Consider sending a password reset link instead.
    // This template includes the password as requested based on the LMS example.
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #333;">Welcome to Our HRMS Portal!</h1>
        </div>
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Dear <strong>${name}</strong>,</p>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">An account has been created for you in our Human Resources Management System (HRMS).</p>
            <div style="background-color: #eef; padding: 15px 20px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #66f;">
                <h2 style="color: #333; font-size: 18px; margin-top: 0; margin-bottom: 15px;">Your Account Details:</h2>
                <ul style="list-style: none; padding: 0; margin: 0;">
                    <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Email:</strong> ${userEmail}</li>
                    <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Role:</strong> ${role}</li>
                    <li style="color: #555; margin-bottom: 10px; font-size: 15px;"><strong>Temporary Password:</strong> <code style="background: #eee; padding: 2px 5px; border-radius: 3px;">${password}</code></li>
                </ul>
            </div>
            <p style="color: #555; font-size: 16px; line-height: 1.6;">Please use these credentials to log in. We strongly recommend changing your password after your first login for security purposes.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Login to HRMS Portal</a>
            </div>
            <p style="color: #777; font-size: 14px; line-height: 1.5; margin-top: 30px;">If you have any questions, please contact the HR department.</p>
            <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Your Company HR Team</strong></p>
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
            <p style="color: #777; font-size: 14px; line-height: 1.5;">Best regards,<br><strong>Your Company HR Team</strong></p>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
          This is an automated message. Please do not reply directly to this email. If you need help, contact HR.
        </div>
    </div>
    `;
  }
}

module.exports = Helper;
