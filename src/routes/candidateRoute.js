const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidateController');
const { safeUpload } = require('../middleware/uploadMiddleware');
const { authenticateUser, authorizeRole } = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../utility/constants');

const requiredDocumentFields = [
  { name: 'documents.photograph', maxCount: 1 },
  { name: 'documents.signature', maxCount: 1 },
  { name: 'documents.panCard', maxCount: 1 },
  { name: 'documents.aadharCardFront', maxCount: 1 },
  { name: 'documents.aadharCardBack', maxCount: 1 },
  { name: 'documents.addressProof', maxCount: 1 },
  { name: 'documents.tenthMarkSheet', maxCount: 1 },
  { name: 'documents.twelfthMarkSheet', maxCount: 1 },
  { name: 'documents.graduationProof', maxCount: 1 },
  { name: 'documents.updatedResume', maxCount: 1 },
  { name: 'documents.cancelledChequeOrPassbook', maxCount: 1 },
];

const optionalDocumentFields = [
  { name: 'documents.form11', maxCount: 1 },
  { name: 'documents.postGraduationProof', maxCount: 1 },
  { name: 'documents.offerLetter', maxCount: 1 },
  { name: 'documents.relievingLetter', maxCount: 1 },
  { name: 'documents.salarySlipOne', maxCount: 1 },
  { name: 'documents.salarySlipTwo', maxCount: 1 },
  { name: 'documents.salarySlipThree', maxCount: 1 },
];

// Combine required and optional fields
const documentFields = [...requiredDocumentFields, ...optionalDocumentFields];

router.post('/', authenticateUser, authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), candidateController.createCandidate);
router.get('/', authenticateUser, candidateController.getCandidates);
router.get('/id/:id', candidateController.getCandidateDetailsById);

router.post('/invite-user/:id',authenticateUser, candidateController.inviteOrRemindUser);

router.get('/validate/:token', candidateController.validateToken);
router.get('/user-details/:token', candidateController.fetchCandidateDetails);
router.post('/save/:token', candidateController.saveDraft);

router.put('/backout/:id', authenticateUser, authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), candidateController.backoutCandidate);

router.put('/approve/:id', authenticateUser, authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), candidateController.approveCandidate);

router.post('/resend/:id', authenticateUser, authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]), candidateController.resendCifInvite);

router.post(
  '/request-device/:id',
  authenticateUser,
  authorizeRole([USER_ROLES.ADMIN, USER_ROLES.HR, USER_ROLES.SUBADMIN]),
  candidateController.requestDevice
);

router.post('/submit/:token',
  safeUpload([]), // Allow any file fields
  candidateController.finalSubmit
);
router.post('/review-update/:id',
  safeUpload([]), // Allow any file fields
  authenticateUser,
  authorizeRole([USER_ROLES?.ADMIN, USER_ROLES?.HR, USER_ROLES?.SUBADMIN]),
  candidateController.reviewUpdateCandidate
);

module.exports = router;