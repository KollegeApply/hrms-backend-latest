const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const Candidate = require('../models/candidateModel');
const CandidateService = require('../services/candidateService');
const candidateValidator = require('../validators/candidateValidator');
const UserDetails = require('../models/userDetailsModel');
const Helper = require('../utility/helper');
const jwt = require('jsonwebtoken');
const candidateService = require('../services/candidateService');
const { validateCIFToken } = require('../utility/common');
const candidateModel = require('../models/candidateModel');
const { uploadToAzure } = require('../utility/azureBlob');

const createCandidate = catchAsync(async (req, res) => {
  const userId = req?.user?.id;
  const {candidateData} = req?.body;
  const validatedData = await candidateValidator.candidateCreateSchema.validateAsync(candidateData);

  const {candidate, token} = await CandidateService.createCandidate(validatedData,userId);

  const inviteLink = `${process.env.HRMS_FRONTEND_URL}/invite-cif/form/${token}`;

  const sendMail = req?.body?.sendMail;


  if(sendMail && process.env.HRMS_FRONTEND_URL){
    const emailSubject = 'Complete Your Candidate Information Form (CIF)';


    const emailMessage = Helper.getCandidateInviteEmail(candidate,inviteLink);

    await Helper.sendEmail({
      receiverEmails: [candidate?.personalEmail],
      subject: emailSubject,
      message: emailMessage,
      fromHR: true,
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
  const {isValid, email} = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

  return res.status(httpStatus.OK).json({status:true, data:email, message: 'Token is valid.' });
});

const fetchCandidateDetails = catchAsync(async (req, res) => {
  const { token } = req.params;
  const {isValid, email} = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

  const candidate = await candidateModel.findOne({ personalEmail: email }).populate('userDetails');
  if (!candidate) return res.status(httpStatus.NOT_FOUND).json({ message: 'Candidate not found.' });
  return res.json({ candidate });
});

const saveDraft = catchAsync(async (req, res) => {
  const { token } = req.params;
  const {isValid, email} = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

  const validatedData = await candidateValidator.candidateDraftSchema.validateAsync(req.body);

  const result = await CandidateService.saveDraft(email, validatedData);
  return  res.status(httpStatus.CREATED).json({ status: true, data: result });
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
  const { token } = req.params;
  const { isValid, email } = await validateCIFToken(token);
  if (!isValid) return res.status(httpStatus.NOT_FOUND).json({ message: 'Invalid or expired link.' });

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
      // Attempt to parse each value. If it's a valid JSON string, it will be converted.
      // If not (e.g., it's a simple string like 'draft'), it will remain as is.
      parsedBody[key] = JSON.parse(req.body[key]);
    } catch (e) {
      // If parsing fails, it's not a JSON string, so use the original value.
      parsedBody[key] = req.body[key];
    }
  }

    const dataToValidate = {
    ...parsedBody,
    documents: {
        ...parsedBody.documents, // Include any existing document data
        ...uploadedPaths // Overwrite with new uploads
    },
  };

  const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);

  const result = await CandidateService.finalSubmit(email, validatedData);
  res.json({ status: true, data: result });
});

const editCandidate = catchAsync(async (req, res) => {
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
        ...parsedBody.documents,
        ...uploadedPaths
    },
  };

  const validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);

  const result = await CandidateService.editCandidate(id, validatedData);
  res.json({ status: true, data: result });
});


const getCandidateDetailsById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const candidate = await Candidate.findById(id)
    .populate("pointOfContact department userDetails");

  if (!candidate) {
    return res.status(404).json({ message: "Candidate not found" });
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

  res.json({status:true, message:"Canidate backout successfully"});
});

module.exports = {
  createCandidate,
  getCandidates,
  validateToken,
  fetchCandidateDetails,
  getCandidateDetailsById,
  saveDraft,
  finalSubmit,
  editCandidate,
  backoutCandidate,
};