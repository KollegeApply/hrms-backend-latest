const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const Candidate = require('../models/candidateModel');
const CandidateService = require('../services/candidateService');
const candidateValidator = require('../validators/candidateValidator');
const UserDetails = require('../models/userDetailsModel');
const Helper = require('../utility/helper');
const jwt = require('jsonwebtoken');
const candidateService = require('../services/candidateService');
const { validateCIFToken, transformDocumentPaths } = require('../utility/common');
const candidateModel = require('../models/candidateModel');
const { uploadToAzure } = require('../utility/azureBlob');
const { HR_EMAIL } = require('../utility/constants');

const createCandidate = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  const { candidateData } = req?.body;
  const validatedData = await candidateValidator.candidateCreateSchema.validateAsync(candidateData);

  const { candidate, token } = await CandidateService.createCandidate(validatedData, userId);

  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;

  const sendMail = req?.body?.sendMail;


  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    const currentUser = await UserDetails.findById(userId).select('firstName lastName email');
    const emailSubject = 'Complete Your Candidate Information Form (CIF)';


    const emailMessage = Helper.getCandidateInviteEmail(candidate, inviteLink);
    const ccEmails = [currentUser?.email];

    await Helper.sendEmail({
      receiverEmails: [candidate?.personalEmail],
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
      cc: ccEmails,
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
  const result = await CandidateService.getCandidates(req.query);

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

  const candidate = await candidateModel
    .findOne({ personalEmail: email })
    .populate('userDetails');

  if (!candidate) {
    return res.status(httpStatus.NOT_FOUND).json({ message: 'Candidate not found.' });
  }

  if (candidate.userDetails?.documents) {
    const docsPlain = candidate.userDetails.documents.toObject
      ? candidate.userDetails.documents.toObject()
      : candidate.userDetails.documents;
    console.log("Docs Plain", docsPlain);
    candidate.userDetails.documents = transformDocumentPaths(docsPlain);
    console.log("Transformed Docs", candidate.userDetails.documents);
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

// const finalSubmit = catchAsync(async (req, res) => {
//   const { token } = req.params;
//   const {isValid, email} = await validateCIFToken(token);
//   if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

//   console.log("Final submit data", req.body);
//   const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(req.body);
//   const result = await CandidateService.finalSubmit(email, validatedData);
//   res.json({ status: true, data: result });
// });

const finalSubmit = catchAsync(async (req, res) => {
  // 1. Validate the token
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);
  if (!isValid) {
    return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });
  }

  // 2. Upload files to Azure and build the `uploadedPaths` object
  const files = req.files || {};
  const uploadedPaths = {};

  for (const [field, fileArray] of Object.entries(files)) {
    if (fileArray && fileArray[0]) {
      const file = fileArray[0];
      const relativePath = await uploadToAzure(file.buffer, file.originalname);
      // Clean the field name (e.g., 'documents.photograph' -> 'photograph')
      const simpleField = field.replace('documents.', '');
      uploadedPaths[simpleField] = relativePath;
    }
  }

  // 3. Parse the stringified JSON fields from the request body
  const parsedBody = {};
  for (const key in req.body) {
    try {
      // This will correctly parse fields like 'personalInfo', 'addressDetails', etc.
      parsedBody[key] = JSON.parse(req.body[key]);
    } catch (e) {
      // If parsing fails, it's a simple string (like 'true' or an ID), so use the original value.
      parsedBody[key] = req.body[key];
    }
  }

  // 4. *** FIX: Correctly construct the final object for validation ***
  // We combine the parsed text fields with the object containing the new file paths.
  const dataToValidate = {
    ...parsedBody,
    documents: {
      ...(parsedBody.documents || {}),
      ...uploadedPaths,
    },
  };


  // 5. Validate the complete data object against the Joi schema
  const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);

  // 6. Pass the validated data to the service layer
  const result = await CandidateService.finalSubmit(email, validatedData);

  // 7. Email
  const sendMail = parsedBody?.sendMail ? true : false;
  if (sendMail && process.env.HRMS_FRONTEND_URL) {
    try {
      const emailSubject = result.status === 'resubmitted'
        ? 'Candidate Information Form (CIF) Re-Submission'
        : 'Candidate Information Form (CIF) Submission';

      const emailMessage = Helper.getCandidateSubmissionEmail(result);
      const ccEmails = result.pointOfContact?.email ? [result.pointOfContact.email] : [];
      await Helper.sendEmail({
        receiverEmails: [HR_EMAIL],
        subject: emailSubject,
        message: emailMessage,
        fromHR: false,
        cc: ccEmails,
      });

      res.json({ status: true, data: result });
    } catch (error) {
      console.error("Error sending email:", error);
    }
  }
});

const reviewUpdateCandidate = catchAsync(async (req, res) => {
  const { id } = req.params; // Using candidate ID

  // This logic is similar to finalSubmit but calls a different service
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

  // We can reuse the finalSubmitSchema or create a specific one
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
  const { candidate, token } = await CandidateService.resendCifInvite(id);

  // Construct the new invite link
  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;
  
  // Get comments from userDetails to include in the email
  const comments = candidate.userDetails?.comments || 'Please review the feedback provided in the form.';

  // Send the resend email
  const emailSubject = 'Action Required: Updates to Your Candidate Information Form (CIF)';
  const emailMessage = Helper.getCandidateResendEmail(candidate, inviteLink, comments);

  const ccEmails = candidate.pointOfContact?.email ? [candidate.pointOfContact.email] : [];

  await Helper.sendEmail({
    receiverEmails: [candidate.personalEmail],
    subject: emailSubject,
    message: emailMessage,
    fromHR: true,
    cc: ccEmails,
  });

  res.json({ status: true, message: 'CIF invite has been resent successfully.' });
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
    resendCifInvite
  };