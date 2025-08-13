const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const Candidate = require('../models/candidateModel');
const CandidateService = require('../services/candidateService');
const candidateValidator = require('../validators/candidateValidator');
const UserDetails = require('../models/userDetailsModel');
const Helper = require('../utility/helper');
const { validateCIFToken, transformDocumentPaths, generateCIFToken } = require('../utility/common');
const candidateModel = require('../models/candidateModel');
const { uploadToAzure } = require('../utility/azureBlob');
const { HR_EMAIL, getTeamEmailConfig } = require('../utility/constants');
const logger = require('../config/logger');
const User = require('../models/userModel');

const createCandidate = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  const { candidateData } = req?.body;
  const team = req.user.team;
  const validatedData = await candidateValidator.candidateCreateSchema.validateAsync(candidateData);

  const { candidate, token } = await CandidateService.createCandidate(validatedData, userId);

  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;

  const sendMail = req?.body?.sendMail;


  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const currentUser = await UserDetails.findById(userId).select('firstName lastName email');
    const emailSubject = 'Complete Your Candidate Information Form (CIF)';


    const emailMessage = Helper.getCandidateInviteEmail(candidate, inviteLink, team);
    const ccEmails = [currentUser?.email];

    await Helper.sendEmail({
      receiverEmails: [candidate?.personalEmail],
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
      cc: ccEmails,
      team,
    });
  }


  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Candidate created and invite email sent.',
    data: candidate,
    inviteLink,
  });
});

const getCandidates = catchAsync(async (req, res) => {
  const team = req.user.team;
  const result = await CandidateService.getCandidates(req.query,team);

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Candidates fetched successfully.',
    data: result.candidates,
    pagination: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  });
});


const validateToken = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

  return res.status(httpStatus.OK).json({ status: true, data: email, message: 'Token is valid.' });
});


const fetchCandidateDetails = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);

  if (!isValid) {
    return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });
  }


  const user = await User.findOne({ email: email});
  let candidate;

  if(user){
    candidate = await User
    .findOne({ email: email })
    .populate('userDetails');
  }else{
    candidate = await candidateModel
    .findOne({ personalEmail: email })
    .populate('pointOfContact','team')
    .populate('userDetails');
  }

  if (!candidate) {
    return res.status(httpStatus.NOT_FOUND).json({ message: 'Candidate not found.' });
  }

  if (candidate.userDetails?.documents) {
    const docsPlain = candidate.userDetails.documents.toObject
      ? candidate.userDetails.documents.toObject()
      : candidate.userDetails.documents;
    candidate.userDetails.documents = transformDocumentPaths(docsPlain);
  }


  return res.json({ candidate });
});


const saveDraft = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

  const validatedData = await candidateValidator.candidateDraftSchema.validateAsync(req.body);

  const result = await CandidateService.saveDraft(email, validatedData);
  return res.status(httpStatus.CREATED).json({ status: true, data: result });
});

const finalSubmit = catchAsync(async (req, res) => {
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);
  if (!isValid) {
    return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });
  }

  const files = req.files || {};

  const uploadedEntries = await Promise.all(
  Object.entries(files).map(async ([field, fileArray]) => {
    if (fileArray?.[0]) {
      const file = fileArray[0];
      const simpleField = field.replace('documents.', '');
      const relativePath = await uploadToAzure(file.buffer, file.originalname);
      return [simpleField, relativePath];
    }
    return null;
  })
);


const uploadedPaths = Object.fromEntries(
  uploadedEntries.filter(Boolean)
);


  const parsedBody = {};
  for (const key in req.body) {
    try {
      parsedBody[key] = JSON.parse(req.body[key]);
    } catch (e) {
      parsedBody[key] = req.body[key];
    }
  }

  const dataToValidate = {
    ...parsedBody,
    documents: {
      ...(parsedBody.documents || {}),
      ...uploadedPaths,
    },
  };


  const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);

  const result = await CandidateService.finalSubmit(email, validatedData);

  const sendMail = parsedBody?.sendMail ? true : false;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const team = result?.pointOfContact?.team;
    try {
      const emailSubject = result.status === 'resubmitted'
        ? 'Candidate Information Form (CIF) Re-Submission'
        : 'Candidate Information Form (CIF) Submission';

        const configEmails = getTeamEmailConfig(team);

      const emailMessage = Helper.getCandidateSubmissionEmail(result);
      const ccEmails = result.pointOfContact?.email ? [result.pointOfContact.email] : [];
      await Helper.sendEmail({
        receiverEmails: [configEmails?.HR_EMAIL],
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        cc: ccEmails,
        team,
      });

      logger.info("Email sent successfully");
    } catch (error) {
      console.error("Error sending email:", error);
    }
  }
  res.json({ status: true, data: result });
});

const reviewUpdateCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;

  const files = req.files || {};
  const uploadedPaths = {};
  for (const [field, fileArray] of Object.entries(files)) {
    if (fileArray && fileArray[0]) {
      const file = fileArray[0];
      const relativePath = await uploadToAzure(file.buffer, file.originalname);
      const simpleField = field.replace('documents.', '');
      uploadedPaths[simpleField] = relativePath;
    }
  }

  const parsedBody = {};
  for (const key in req.body) {
    try {
      parsedBody[key] = JSON.parse(req.body[key]);
    } catch (e) {
      parsedBody[key] = req.body[key];
    }
  }

  const dataToValidate = {
    ...parsedBody,
    documents: {
      ...(parsedBody.documents || {}),
      ...uploadedPaths,
    },
  };

  const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);

  const result = await CandidateService.reviewUpdateCandidate(id, validatedData);
  res.json({ status: true, data: result, message: "Candidate updated successfully." });
});


const getCandidateDetailsById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const candidate = await Candidate.findById(id)
    .populate("pointOfContact department userDetails");

  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  if (candidate.userDetails?.documents) {
    const docsPlain = candidate.userDetails.documents.toObject
      ? candidate.userDetails.documents.toObject()
      : candidate.userDetails.documents;

    candidate.userDetails.documents = transformDocumentPaths(docsPlain);
  }

  res.json({ candidate });
});

const backoutCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;

  const candidate = await Candidate.findById(id);
  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
  }

  candidate.status = "backout";
  await candidate.save();

  res.json({ status: true, message: "Canidate backout successfully" });
});

const approveCandidate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CandidateService.approveCandidate(id);
  res.json({ status: true, data: result, message: "Candidate approved successfully." });
});

const resendCifInvite = catchAsync(async (req, res) => {
  const { id } = req.params;
  const team = req.user.team;
  const { candidate, token } = await CandidateService.resendCifInvite(id);

  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;

  const comments = candidate.userDetails?.comments || 'Please review the feedback provided in the form.';

  const emailSubject = 'Action Required: Updates to Your Candidate Information Form (CIF)';
  const emailMessage = Helper.getCandidateResendEmail(candidate, inviteLink, comments, team);

  const ccEmails = candidate.pointOfContact?.email ? [candidate.pointOfContact.email] : [];

  await Helper.sendEmail({
    receiverEmails: [candidate.personalEmail],
    subject: emailSubject,
    message: emailMessage,
    fromHR: true,
    cc: ccEmails,
    team,
  });

  res.json({ status: true, message: 'CIF invite has been resent successfully.' });
});

const requestDevice = catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestData = req.body;
  const team = req.user.team;

  const { candidate, requests } = await CandidateService.requestDevice(id, requestData);

  const policies = [];
  if (requests.byod) policies.push('BYOD (Bring Your Own Device)');
  if (requests.byov) policies.push('BYOV (Bring Your Own Vehicle)');

  if (policies.length > 0) {
    const policyText = policies.join(' & ');
    const emailSubject = `Welcome! Please review the ${policyText} onboarding policies`;
    const emailMessage = Helper.getOnboardingPolicyEmail(candidate, policies, team);

    await Helper.sendEmail({
      receiverEmails: [candidate.personalEmail],
      subject: emailSubject,
      message: emailMessage,
      team,
    });
  }

  res.json({ status: true, message: 'Request sent successfully.' });
});

const inviteOrRemindUser = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  const team = req.user.team;
  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(httpStatus.NOT_FOUND).json({
      status: false,
      message: "User not found",
    });
  }

  const token = generateCIFToken(user?.email);
  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;

  const currentUser = await User.findById(userId).select("firstName lastName email");
  const ccEmails = [currentUser?.email];

  const reminderStatuses = ["pending", "draft","reminder_sent"];

  let emailSubject, emailMessage, newStatus;

  if (reminderStatuses.includes(user.formStatus)) {
    emailSubject = "Gentle Reminder: Complete Your Candidate Information Form (CIF)";
    emailMessage = Helper.getEmployeeDataReminderEmail(user, inviteLink, team);
    newStatus = "reminder_sent";
  } else {
    emailSubject = "Complete Your Candidate Information Form (CIF)";
    emailMessage = Helper.getEmployeeDataRequestEmail(user, inviteLink, team);
    newStatus = "pending";
  }

  if (process.env.HRMS_FRONTEND_URL) {
    await Helper.sendEmail({
      receiverEmails: [user?.email],
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
      cc: ccEmails,
      team,
    });
  }

  user.formStatus = newStatus;
  await user.save();

  res.status(httpStatus.CREATED).json({
    status: true,
    message: newStatus === "reminder_sent"
      ? "Gentle reminder email sent successfully"
      : "Invite email sent successfully",
    data: user,
    inviteLink,
  });
});



module.exports = {
  createCandidate,
  getCandidates,
  validateToken,
  fetchCandidateDetails,
  getCandidateDetailsById,
  saveDraft,
  finalSubmit,
  reviewUpdateCandidate,
  backoutCandidate,
  approveCandidate,
  resendCifInvite,
  requestDevice,
  inviteOrRemindUser,
};