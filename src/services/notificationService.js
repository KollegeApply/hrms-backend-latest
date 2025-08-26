const User = require('../models/userModel');
const Regularization = require('../models/regularizationModel');
const logger = require('../config/logger');

class NotificationService {
  /**
   * Send notification for new regularization request
   */
  async notifyNewRegularization(regularizationId) {
    try {
      const regularization = await Regularization.findById(regularizationId)
        .populate('user', 'name email teamLeadId subTeamLeadId')
        .populate('user.teamLeadId', 'name email')
        .populate('user.subTeamLeadId', 'name email');

      if (!regularization) {
        logger.error(`Regularization not found for notification: ${regularizationId}`);
        return;
      }

      const { user } = regularization;
      const approver = user.teamLeadId || user.subTeamLeadId;

      if (!approver) {
        logger.warn(`No approver found for user: ${user._id}`);
        return;
      }

      // Send notification to approver
      await this.sendEmail({
        to: approver.email,
        subject: 'New Regularization Request',
        template: 'new-regularization-request',
        data: {
          approverName: approver.name,
          employeeName: user.name,
          date: regularization.date,
          reason: regularization.reason,
          regularizationId: regularization._id
        }
      });

      // Send confirmation to employee
      await this.sendEmail({
        to: user.email,
        subject: 'Regularization Request Submitted',
        template: 'regularization-submitted',
        data: {
          employeeName: user.name,
          date: regularization.date,
          reason: regularization.reason,
          regularizationId: regularization._id
        }
      });

      logger.info(`Notifications sent for regularization: ${regularizationId}`);
    } catch (error) {
      logger.error(`Error sending new regularization notification: ${error.message}`);
    }
  }

  /**
   * Send notification for approval
   */
  async notifyApproval(regularizationId, approverId) {
    try {
      const regularization = await Regularization.findById(regularizationId)
        .populate('user', 'name email')
        .populate('approvedBy', 'name email');

      if (!regularization) {
        logger.error(`Regularization not found for approval notification: ${regularizationId}`);
        return;
      }

      // Notify employee about approval
      await this.sendEmail({
        to: regularization.user.email,
        subject: 'Regularization Request - Approved',
        template: 'regularization-approved',
        data: {
          employeeName: regularization.user.name,
          date: regularization.date,
          approverName: regularization.approvedBy.name,
          correctedCheckIn: regularization.correctedCheckIn,
          correctedCheckOut: regularization.correctedCheckOut,
          regularizationId: regularization._id
        }
      });

      logger.info(`Approval notification sent for regularization: ${regularizationId}`);
    } catch (error) {
      logger.error(`Error sending approval notification: ${error.message}`);
    }
  }

  /**
   * Send notification for rejection
   */
  async notifyRejection(regularizationId, approverId, reason) {
    try {
      const regularization = await Regularization.findById(regularizationId)
        .populate('user', 'name email')
        .populate('approvedBy', 'name email');

      if (!regularization) {
        logger.error(`Regularization not found for rejection notification: ${regularizationId}`);
        return;
      }

      // Notify employee about rejection
      await this.sendEmail({
        to: regularization.user.email,
        subject: 'Regularization Request - Rejected',
        template: 'regularization-rejected',
        data: {
          employeeName: regularization.user.name,
          date: regularization.date,
          approverName: regularization.approvedBy.name,
          reason: reason,
          regularizationId: regularization._id
        }
      });

      logger.info(`Rejection notification sent for regularization: ${regularizationId}`);
    } catch (error) {
      logger.error(`Error sending rejection notification: ${error.message}`);
    }
  }

  /**
   * Send email notification (placeholder for email service integration)
   */
  async sendEmail({ to, subject, template, data }) {
    try {
      // TODO: Integrate with your email service (SendGrid, AWS SES, etc.)
      logger.info(`Email would be sent to ${to} with subject: ${subject}`);
      logger.info(`Template: ${template}, Data:`, data);
      
      // Example integration with a hypothetical email service:
      // await emailService.send({
      //   to,
      //   subject,
      //   template,
      //   data
      // });
    } catch (error) {
      logger.error(`Error sending email to ${to}: ${error.message}`);
    }
  }

  /**
   * Send in-app notification (placeholder for real-time notifications)
   */
  async sendInAppNotification(userId, message, type = 'info') {
    try {
      // TODO: Integrate with your real-time notification service (Socket.io, etc.)
      logger.info(`In-app notification would be sent to user ${userId}: ${message}`);
      
      // Example integration with Socket.io:
      // io.to(`user_${userId}`).emit('notification', {
      //   message,
      //   type,
      //   timestamp: new Date()
      // });
    } catch (error) {
      logger.error(`Error sending in-app notification to user ${userId}: ${error.message}`);
    }
  }
}

module.exports = new NotificationService();
