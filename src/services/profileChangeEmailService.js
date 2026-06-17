const moment = require('moment-timezone');
const logger = require('../config/logger');
const Helper = require('../utility/helper');
const User = require('../models/userModel');
const { getTeamEmailConfig } = require('../utility/constants');

const DOCUMENT_ATTACHMENT_LABELS = {
  aadharCardFront: 'Aadhar Card Front',
  aadharCardBack: 'Aadhar Card Back',
  panCard: 'PAN Card',
  tenthMarkSheet: '10th Mark Sheet',
  twelfthMarkSheet: '12th Mark Sheet',
  graduationProof: 'Graduation Proof',
  cancelledChequeOrPassbook: 'Cancelled Cheque',
};

class ProfileChangeEmailService {
  formatDateTime(date) {
    return moment(date).tz('Asia/Kolkata').format('DD MMM YYYY, HH:mm');
  }

  getAttachmentLabel(request) {
    if (request.routeKey === 'documents' || request.valueType === 'attachment') {
      return `Yes — ${request.subCategory} attached`;
    }

    if (request.requiresDocuments?.length) {
      const labels = request.requiresDocuments.map(
        (key) => DOCUMENT_ATTACHMENT_LABELS[key] || key
      );
      return `Yes — ${labels.join(', ')} attached`;
    }

    return 'No';
  }

  getEmployeeName(user) {
    return `${user.firstName || ''} ${user.lastName || ''}`.trim();
  }

  getTlName(user) {
    const tl = user.teamLeadId;
    if (!tl) return '';
    return `${tl.firstName || ''} ${tl.lastName || ''}`.trim();
  }

  async notifySubmission(employee, requests) {
    if (!requests?.length || !employee?.email) return;

    const team = employee.team;
    const category = requests[0].category;
    const fieldsChanged = requests.map((request) => request.subCategory).join(', ');
    const submittedOn = this.formatDateTime(requests[0].createdAt || new Date());

    await Helper.sendEmail({
      receiverEmails: [employee.email],
      subject: 'Your profile change request has been submitted',
      message: Helper.profileChangeSubmittedEmailEmployee({
        firstName: employee.firstName,
        submittedOn,
        category,
        fieldsChanged,
        team,
      }),
      team,
    });

    const config = getTeamEmailConfig(team);
    if (!config?.HR_EMAIL) {
      logger.warn('HR email not configured; skipping profile change HR notification.');
      return;
    }

    const employeeName = this.getEmployeeName(employee);
    const employeeId = employee.employeeId || 'N/A';
    const department = employee.department?.name || 'N/A';
    const tlName = this.getTlName(employee);

    for (const request of requests) {
      await Helper.sendEmail({
        receiverEmails: [config.HR_EMAIL],
        subject: `Action required: New profile update request from ${employeeName}`,
        message: Helper.profileChangeNewRequestEmailHR({
          employeeName,
          employeeId,
          department,
          tlName,
          submittedOn: this.formatDateTime(request.createdAt || new Date()),
          category: request.category,
          subCategory: request.subCategory,
          attachmentLabel: this.getAttachmentLabel(request),
          team,
        }),
        team,
      });
    }
  }

  async notifyApproved(request) {
    const employee = await User.findById(request.userId).select(
      'email firstName lastName team'
    );

    if (!employee?.email) return;

    await Helper.sendEmail({
      receiverEmails: [employee.email],
      subject: 'Your profile update has been approved',
      message: Helper.profileChangeApprovedEmailEmployee({
        firstName: employee.firstName,
        approvedOn: this.formatDateTime(request.reviewedAt || new Date()),
        category: request.category,
        fieldsUpdated: request.subCategory,
        team: employee.team || request.team,
      }),
      fromHR: true,
      team: employee.team || request.team,
    });
  }

  async notifyRejected(request) {
    const employee = await User.findById(request.userId).select(
      'email firstName lastName team'
    );

    if (!employee?.email) return;

    await Helper.sendEmail({
      receiverEmails: [employee.email],
      subject: 'Your profile update request was not approved',
      message: Helper.profileChangeRejectedEmailEmployee({
        firstName: employee.firstName,
        rejectedOn: this.formatDateTime(request.reviewedAt || new Date()),
        category: request.category,
        fieldsRequested: request.subCategory,
        rejectionNote: request.rejectNote || '',
        team: employee.team || request.team,
      }),
      fromHR: true,
      team: employee.team || request.team,
    });
  }
}

module.exports = new ProfileChangeEmailService();
