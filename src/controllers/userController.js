// src/controllers/userController.js
const { default: httpStatus } = require('http-status');
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');
const userValidator = require('../validators/userValidator');
const Helper = require('../utility/helper');
const ApiError = require('../utility/ApiError'); // Ensure this utility exists
const catchAsync = require('../utility/catchAsync'); // Ensure this utility exists
const logger = require('../config/logger');
const { CSV_TYPES, RANK, TEAM_SD, TEAM_KAP, getTeamEmailConfig } = require('../utility/constants');
const User = require('../models/userModel');
const UserDetails = require('../models/userDetailsModel');
const candidateValidator = require('../validators/candidateValidator');
const { uploadToAzure } = require('../utility/azureBlob');
const { transformDocumentPaths } = require('../utility/common');
const EmployeeHistory = require('../models/employeeHistory');
const crypto = require('crypto');
const moment = require('moment-timezone');

// Helper function to validate URLs
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}


/**
 * Utility to generate JWT token.
 * @param {object} user - User object (should have id and role).
 * @returns {string} - JWT token.
 */
const generateToken = (user) => {
  const payload = { id: user?.id, role: user?.role };
  // Use a reasonable expiration time (e.g., '1d', '7d', '1h')
  return jwt.sign(payload, process?.env?.SECRET_KEY, { expiresIn: '7d' });
};

// Wrap controller methods with catchAsync for cleaner error handling
const createUser = catchAsync(async (req, res) => {
  // 1. Validate request body
  if (req?.body?.role === 'subadmin') {
    req.body.teamLeadId = '6808c6d86d2d1bdfd589c57a';
  }

  req.body.team = req.user.team;

  const validatedData = await userValidator?.createUserSchema?.validateAsync(
    req?.body
  );
  const currentUserRank = RANK[req?.user?.role];
  const targetUserRank = RANK[validatedData?.role];
  let user;
  if (targetUserRank != 1 && currentUserRank < 4) {
    user = await userService.createUser(validatedData);
    // sending mail
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      const teamCode = req?.user?.team || 'SD';
      const emailConfig = getTeamEmailConfig(teamCode);
      logger.info(`Sending welcome email to ${user.email}`);
      Helper.sendEmail({
        receiverEmails: [user?.email],
        subject: `Welcome to ${emailConfig?.TEAM_NAME} – Let’s Get You Started!`,
        message: Helper.getWelcomeEmail(
          user?.firstName,
          user?.email,
          validatedData?.password,
          process?.env?.HRMS_FRONTEND_URL,
          emailConfig?.TEAM_NAME,
        ),
        fromHr: true,
        team: teamCode,
      }).catch((err) =>
        logger.error(`Failed to send welcome email to ${user?.email}:`, err)
      );
    }

    // Send response
    res.status(httpStatus?.CREATED).json({
      status: true,
      message: 'User created successfully.',
      data: user, // User object already cleaned by toJSON
    });
  } else {
    res.status(httpStatus?.FORBIDDEN).json({
      status: false,
      message: 'You cannot create user with given role',
    });
  }
});

const getAllUsers = catchAsync(async (req, res) => {
  // 1. Validate query parameters
  const validatedQuery = await userValidator?.getAllUsersSchema?.validateAsync(
    req?.query
  );

  // Aceess current user id
  const currentUser = req?.user;


  // Meeting attendee flag should bypass team scoping
  const queryOptions = validatedQuery?.isMeetingAttendee
    ? { ...validatedQuery, context: 'meeting' }
    : validatedQuery;

  // 2. Call service to get users
  const result = await userService?.getAllUsers(queryOptions, currentUser); // Service handles pagination logic

  // 3. Transform profile photos to full URLs if needed
  if (result.data && Array.isArray(result.data)) {
    result.data.forEach(user => {
      if (user.profilePhoto && !user.profilePhoto.startsWith('http')) {
        const transformedPaths = transformDocumentPaths({ profilePhoto: user.profilePhoto });
        user.profilePhoto = transformedPaths.profilePhoto;
      }
    });
  }

  // 4. Send response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Users retrieved successfully.',
    ...result, // Spread the result which contains data and pagination info
  });
});

// Meeting attendees: allow TL/SubTL to fetch all users without team scoping
const getAllUsersForMeeting = catchAsync(async (req, res) => {
  const validatedQuery = await userValidator?.getAllUsersSchema?.validateAsync(
    { ...req?.query, isPaginated: false }
  );

  const currentUser = req?.user;

  // Inject a special context understood by service (without changing default route behavior)
  const result = await userService?.getAllUsers({ ...validatedQuery, context: 'meeting' }, currentUser);

  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Users retrieved successfully.',
    ...result,
  });
});

const getUserById = catchAsync(async (req, res) => {
  // 1. Validate ID parameter (using Helper for basic check, Joi for strictness)
  await userValidator?.mongoIdSchema?.validateAsync(req.params); // Validate ID format
  const userId = req?.params?.id;

  if (!Helper.isValidMongoId(userId)) {
    // Redundant if Joi validation passes, but good defense
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }

  // 2. Call service to get user
  const user = await userService?.getUserById(userId);

  // 3. Handle not found
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
  }

  // 4. Transform profile photo to full URL if needed
  if (user.profilePhoto && !user.profilePhoto.startsWith('http')) {
    const transformedPaths = transformDocumentPaths({ profilePhoto: user.profilePhoto });
    user.profilePhoto = transformedPaths.profilePhoto;
  }

  // 5. Send response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'User retrieved successfully.',
    data: user, // User object already cleaned by toJSON
  });
});

const updateUser = catchAsync(async (req, res) => {
  await userValidator?.mongoIdSchema?.validateAsync(req.params);
  const userId = req?.params?.id;
  if (!Helper.isValidMongoId(userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }
  const oldUser = await User.findById(userId);
  const validatedData = await userValidator?.updateUserSchema?.validateAsync(
    req?.body
  );
  if (Object.keys(validatedData).length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No valid fields provided for update.'
    );
  }

  // Map onrollDate to effectiveAt if effectiveAt is not provided and onrollDate exists
  // This ensures the date selected on frontend is stored in employeeHistory.effectiveAt
  if (!validatedData.effectiveAt && validatedData.onrollDate) {
    validatedData.effectiveAt = validatedData.onrollDate;
  }

  const currentUserId = req?.user?.id;
  const clickedUserId = userId;

  const updatedUser = await userService?.updateUser(userId, validatedData, {
    _id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  });

  if (!updatedUser) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'User not found or update failed.'
    );
  }

  // sending mail
  if (oldUser?.status === 'probation' && updatedUser?.status === 'onroll') {
    // Use onrollDate from payload if provided, otherwise fetch from EmployeeHistory
    let onrollDate = null;
    
    // First, check if onrollDate is provided in the request body
    if (req.body?.onrollDate) {
      onrollDate = new Date(req.body.onrollDate);
      logger.info(`Using onrollDate from payload for user ${userId}: ${req.body.onrollDate}`);
    } else {
      // Fallback: Fetch onrollDate from EmployeeHistory
      try {
        const statusChangeRecord = await EmployeeHistory.findOne({
          employeeId: userId,
          entity: 'status',
          previous: 'probation',
          changed: 'onroll'
        }).sort({ actionAt: -1, createdAt: -1 }); // Get the most recent record
        
        if (statusChangeRecord) {
          onrollDate = statusChangeRecord.actionAt || statusChangeRecord.createdAt;
          logger.info(`Found onrollDate from EmployeeHistory for user ${userId}: ${onrollDate}`);
        } else {
          // Fallback: if no history record found, use current date
          logger.warn(`No EmployeeHistory record found for onroll status change for user ${userId}, using current date`);
          onrollDate = new Date();
        }
      } catch (error) {
        logger.error(`Error fetching onrollDate from EmployeeHistory for user ${userId}:`, error);
        // Fallback to current date if there's an error
        onrollDate = new Date();
      }
    }

    // Format the onrollDate
    const formattedDate = moment(onrollDate).tz('Asia/Kolkata').format('DD MMMM YYYY');
    const sendMail = req?.body?.sendMail === true;
    if (sendMail && process?.env?.HRMS_FRONTEND_URL) {
      logger.info(
        `Conversion from probation to onroll ${updatedUser?.email}, onrollDate: ${formattedDate}`
      );
      Helper.sendEmail({
        receiverEmails: [updatedUser?.email],
        subject: `You've Earned Full-Time Status! Congratulations !!`,
        message: Helper.fullTimeConversion(
          updatedUser?.firstName,
          formattedDate,
          updatedUser?.jobTitle,
          updatedUser?.team,
        ),
        fromHr: true,
        team: updatedUser?.team,
      }).catch((err) =>
        logger.error(
          `Failed to send conversion from probation to full-time email ${updatedUser?.email}:`,
          err
        )
      );
    }
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'User updated successfully.',
    data: updatedUser, // User object already cleaned by toJSON
  });
});

const deleteUser = catchAsync(async (req, res) => {
  // 1. Validate ID parameter
  await userValidator?.mongoIdSchema?.validateAsync(req.params);
  const userId = req?.params?.id;
  if (!Helper.isValidMongoId(userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID format.');
  }
  const user = await User.findById(userId);
  const currentUserRank = RANK[req?.user?.role];
  const targetedUserRank = RANK[user?.role];
  const team = req?.user?.team;

  // check for hierarchy
  if (currentUserRank < targetedUserRank) {
    // 2. Call service to delete user (soft delete)
    const success = await userService.deleteUser(userId, team);

    // 3. Handle not found
    if (!success) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    // 4. Send response (HTTP 204 No Content is also suitable for successful deletions)
    res?.status(httpStatus.OK).json({
      status: true,
      message: 'User deleted successfully.',
    });
  } else {
    res.status(httpStatus.FORBIDDEN).json({
      status: false,
      message: 'You cannot delete this user',
    });
  }
});

const login = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email, password } = await userValidator.loginSchema.validateAsync(
    req?.body
  );

  // 2. Call service to authenticate user
  const user = await userService?.authenticateUser(email, password);

  // 3. Handle authentication failure
  if (!user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password.');
  }

  // 4. Generate JWT token
  const token = generateToken(user);

  // 5. Send response with user data and token
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Login successful.',
    data: user, // User object already cleaned by toJSON
    token: token,
  });
});

const changePassword = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { oldPassword, newPassword } =
    await userValidator.changePasswordSchema.validateAsync(req.body);

  // 2. Get user ID from authenticated user
  const userId = req?.user?.id; // Assumes authenticateUser middleware ran successfully

  // 3. Call service to change password
  await userService.changePassword(userId, oldPassword, newPassword);

  // 4. Send success response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Password changed successfully.',
  });
});

const forgotPassword = catchAsync(async (req, res) => {
  // 1. Validate request body
  const { email } = await userValidator.forgotPasswordSchema.validateAsync(
    req?.body
  );

  // 2. Call service to request reset
  await userService?.requestPasswordReset(email);

  // 3. Send generic success response (for security)
  res?.status(httpStatus.OK).json({
    status: true,
    message:
      'If an account with that email exists, a password reset link has been sent.',
  });
});

const verifyOtp = catchAsync(async (req, res) => {
  // 1. Validate request body for email, otp, newPassword
  const { email, newPassword, otp } =
    await userValidator.verifyOtpSchema.validateAsync(req.body);

  // 2. Call service to verify OTP and reset password
  await userService?.verifyOtpAndResetPassword(email, newPassword, otp);

  // 3. Send success response
  res?.status(httpStatus.OK).json({
    status: true,
    message: 'Password has been reset successfully.',
  });
});

// === Section approvals ===
const requestSectionApproval = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { section } = req.body;
  if (!['bankDetails', 'documents'].includes(section)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid section');
  }

  const user = await User.findById(userId).populate('userDetails');
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  if (!user.userDetails) {
    user.userDetails = await new UserDetails({}).save();
    await user.save();
  }

  const ud = user.userDetails;
  const statusKey = section === 'bankDetails' ? 'bankApprovalStatus' : 'documentsApprovalStatus';
  const requestedAtKey = section === 'bankDetails' ? 'bankApprovalRequestedAt' : 'documentsApprovalRequestedAt';
  ud[statusKey] = 'pending';
  ud[requestedAtKey] = new Date();
  await ud.save();

  // email
  const token = jwt.sign({ uid: userId, section }, process.env.SECRET_KEY, { expiresIn: '7d' });
  const base = process.env.HRMS_FRONTEND_URL || '';
  const approveUrl = `${base}/api/v1/users/section-approval/token/${token}?action=approve`;
  const rejectUrl = `${base}/api/v1/users/section-approval/token/${token}?action=reject`;
  const teamCode = req.user.team || 'SD';
  const emailConfig = getTeamEmailConfig(teamCode);
  const emails = [emailConfig.HR_EMAIL];
  if (emails.length) {
    const message = Helper.getSectionApprovalRequestEmail({
      employeeName: `${user.firstName} ${user.lastName}`,
      section,
      approveUrl,
      rejectUrl,
      team: teamCode,
    });
    await Helper.sendEmail({ receiverEmails: emails, subject: 'Profile Edit Approval Request', message, fromHr: false, team: teamCode })
      .catch((e) => logger.error('email failed', e));
  }

  return res.status(httpStatus.OK).json({ status: true, message: 'Approval requested' });
});

const getSectionApprovalStatus = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const user = await User.findById(userId).populate('userDetails');
  const ud = user?.userDetails;
  return res.status(httpStatus.OK).json({
    status: true, data: {
      bank: ud?.bankApprovalStatus || null,
      documents: ud?.documentsApprovalStatus || null,
    }
  });
});

const sectionApprovalByToken = catchAsync(async (req, res) => {
  const { token } = req.params;
  const action = (req.query.action || req.body.action || '').toString();
  if (!['approve', 'reject'].includes(action)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid action');
  }
  let payload; try { payload = jwt.verify(token, process.env.SECRET_KEY); } catch (e) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or expired token');
  }
  const { uid, section } = payload;
  const user = await User.findById(uid).populate('userDetails');
  if (!user || !user.userDetails) throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  const statusKey = section === 'bankDetails' ? 'bankApprovalStatus' : 'documentsApprovalStatus';
  const decidedAtKey = section === 'bankDetails' ? 'bankApprovalDecidedAt' : 'documentsApprovalDecidedAt';
  user.userDetails[statusKey] = action === 'approve' ? 'approved' : 'rejected';
  user.userDetails[decidedAtKey] = new Date();
  await user.userDetails.save();
  return res.status(httpStatus.OK).json({ status: true, message: `Request ${action}d` });
});
const bulkUpload = async (req, res) => {
  const activity = 'Bulk Upload Users |';
  try {
    const usersFile = req?.files?.[0];

    if (!usersFile) {
      return res?.status(400).send({
        status: false,
        message: 'CSV file is required.',
        isErrorForUser: true,
      });
    }

    if (!CSV_TYPES.includes(usersFile?.mimetype)) {
      return res?.status(400)?.send({
        status: false,
        message: 'Invalid file type. Please upload a valid CSV file.',
        isErrorForUser: true,
      });
    }

    const {
      status,
      code,
      data,
      message,
      isErrorForUser = false,
    } = await userService.bulkUpload(usersFile, activity);


    // Send response back
    return res?.status(code || 200).send({
      status,
      ...(message && { message }),
      ...(data && { data }), // 'data' will contain the invalid rows report
      isErrorForUser,
    });
  } catch (error) {
    console.error(`${activity} Error during bulk upload process:`, error);
    const statusCode = error?.statusCode || 500;
    const message =
      error?.message || 'An unexpected error occurred during bulk user upload.';

    const clientMessage =
      statusCode === 500 ? 'An internal server error occurred.' : message;

    return res.status(statusCode).send({
      status: false,
      message: clientMessage,
      isErrorForUser: statusCode !== 500,
    });
  }
};

const getUserHistory = async (req, res) => {
  try {
    const userId = req?.user?.id;
    const validateData =
      await userValidator?.getUserHistorySchema?.validateAsync({ userId });
    const result = await userService.getUserHistory(validateData?.userId);
    return res.status(result.statusCode).json(result.data);
  } catch (error) {
    console.error('Error in getUserHistory controller:', error);
    return res
      .status(500)
      .json({ message: 'An unexpected server error occurred.' });
  }
};

const getUserByTlId = async (req, res) => {
  try {
    const userId = req?.query?.userId;
    const userRole = req?.query?.userRole;
    const userTeam = req?.user?.team;

    const validateData =
      await userValidator?.getUserByTlIdSchema?.validateAsync({ userId, userRole });
    const result = await userService.getUserByTlId(validateData?.userId, userRole, userTeam);
    return res.status(result.statusCode).json(result);
  } catch (error) {
    console.error('Error in getUserByTlId controller:', error);
    return res
      .status(500)
      .json({ message: 'An unexpected server error occurred.' });
  }
};

const approveUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Get user details
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user formStatus to approved
    user.formStatus = 'approved';
    await user.save();

    res.json({ status: true, data: user, message: "User approved successfully." });
  } catch (error) {
    console.error('Error in approveUser controller:', error);
    return res
      .status(500)
      .json({ message: 'An unexpected server error occurred.' });
  }
};

const updateUserCifForm = async (req, res) => {
  try {
    ('=== updateUserCifForm START ===');
    ('Params:', req.params);
    ('Body keys:', Object.keys(req.body));
    ('Files count:', req.files?.length || 0);

    const { id } = req.params;
    const files = req.files || {};

    // Get user details
    ('Looking for user with ID:', id);
    const user = await User.findById(id).populate('userDetails');
    if (!user) {
      ('User not found with ID:', id);
      return res.status(404).json({ message: "User not found" });
    }

    ('User found:', {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      hasUserDetails: !!user.userDetails
    });

    // Handle file uploads similar to candidate form
    const uploadedPaths = {};
    ('Processing files:', files.length);
    for (const file of files) {
      if (file) {
        ('Uploading file:', file.originalname, 'field:', file.fieldname);
        try {
          const relativePath = await uploadToAzure(file.buffer, file.originalname, 'hrms-cif-documents/');
          const simpleField = file.fieldname.replace('documents.', '');
          uploadedPaths[simpleField] = relativePath;
          ('File uploaded successfully:', relativePath);
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          throw uploadError;
        }
      }
    }

    // Parse request body
    const parsedBody = {};
    ('Parsing request body...');
    for (const key in req.body) {
      try {
        parsedBody[key] = JSON.parse(req.body[key]);
        (`Parsed ${key}:`, typeof parsedBody[key]);
      } catch (e) {
        parsedBody[key] = req.body[key];
        (`Using raw value for ${key}:`, typeof parsedBody[key]);
      }
    }

    // Filter uploaded paths
    const filteredUploadedPaths = {};
    Object.entries(uploadedPaths).forEach(([key, value]) => {
      if (value && value.trim() !== '') {
        filteredUploadedPaths[key] = value;
      }
    });

    // Prepare data for validation
    ('Original documents from body:', parsedBody.documents);
    ('Newly uploaded paths:', filteredUploadedPaths);

    // Filter out invalid URLs from existing documents
    const validExistingDocuments = {};
    if (parsedBody.documents) {
      Object.entries(parsedBody.documents).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '') {
          // Check if it's a valid URL (starts with http and is properly formatted)
          if (value.startsWith('http') && isValidUrl(value)) {
            validExistingDocuments[key] = value;
            (`Preserving existing document ${key}:`, value);
          } else {
            (`Skipping invalid document ${key}:`, value);
          }
        }
      });
    }

    // Clean personalInfo to remove fields not allowed by candidate schema
    const cleanedPersonalInfo = { ...parsedBody.personalInfo };

    // Remove individual child fields that might still be present (fallback cleanup)
    // The frontend should transform these into children array, but clean up any remaining ones
    const childFieldsToRemove = ['child1Name', 'child1Dob', 'child1Gender', 'child2Name', 'child2Dob', 'child2Gender', 'child3Name', 'child3Dob', 'child3Gender', 'child4Name', 'child4Dob', 'child4Gender', 'child5Name', 'child5Dob', 'child5Gender'];
    childFieldsToRemove.forEach(field => {
      if (cleanedPersonalInfo.hasOwnProperty(field)) {
        (`Removing field ${field} from personalInfo`);
        delete cleanedPersonalInfo[field];
      }
    });

    // Also clean other fields that might not be allowed
    const otherFieldsToRemove = ['_id', 'isDeleted', 'createdAt', 'updatedAt', '__v', 'lockedFields', 'hrValidation'];
    otherFieldsToRemove.forEach(field => {
      if (parsedBody.hasOwnProperty(field)) {
        (`Removing field ${field} from parsedBody`);
        delete parsedBody[field];
      }
    });

    const dataToValidate = {
      ...parsedBody,
      personalInfo: cleanedPersonalInfo,
      documents: {
        ...validExistingDocuments,
        ...filteredUploadedPaths,
      },
    };

    ('Final documents for validation:', dataToValidate.documents);
    ('Cleaned personalInfo:', dataToValidate.personalInfo);

    // Validate the data using candidate validator (same structure)
    ('Validating data with candidateValidator...');
    ('Data to validate keys:', Object.keys(dataToValidate));
    let validatedData;
    try {
      validatedData = await candidateValidator.finalSubmitSchema.validateAsync(dataToValidate);
      ('Validation successful');
    } catch (validationError) {
      console.error('Validation error:', validationError);
      throw validationError;
    }

    // Update userDetails
    ('Updating userDetails...');
    ('User has userDetails:', !!user.userDetails);
    if (user.userDetails) {
      // Update existing userDetails
      ('Updating existing userDetails');
      Object.assign(user.userDetails, validatedData);
      await user.userDetails.save();
      ('Existing userDetails updated successfully');
    } else {
      // Create new userDetails if doesn't exist
      ('Creating new userDetails');
      const newUserDetails = new UserDetails(validatedData);
      await newUserDetails.save();
      user.userDetails = newUserDetails._id;
      await user.save();
      ('New userDetails created and linked successfully');
    }

    // Clean up any invalid document references in the database
    if (user.userDetails && user.userDetails.documents) {
      let hasInvalidDocs = false;
      const cleanedDocuments = {};

      Object.entries(user.userDetails.documents).forEach(([key, value]) => {
        if (value && typeof value === 'string' && value.trim() !== '') {
          if (value.startsWith('http') && isValidUrl(value)) {
            cleanedDocuments[key] = value;
          } else {
            (`Removing invalid document reference ${key}:`, value);
            hasInvalidDocs = true;
          }
        }
      });

      if (hasInvalidDocs) {
        user.userDetails.documents = cleanedDocuments;
        await user.userDetails.save();
        ('Cleaned up invalid document references');
      }
    }

    // Update user formStatus to "underReview" when HR edits the form
    if (user.formStatus !== 'approved') {
      user.formStatus = 'underReview';
    }
    await user.save();
    ('User formStatus updated to underReview');                         

    // Populate the updated userDetails for response
    await user.populate('userDetails');

    res.json({ status: true, data: user, message: "User CIF form updated successfully and status changed to under review." });
  } catch (error) {
    console.error('Error in updateUserCifForm controller:', error);
    return res
      .status(500)
      .json({ message: 'An unexpected server error occurred.' });
  }
};

// Upload profile photo
const uploadProfilePhoto = catchAsync(async (req, res) => {
  try {
    ('=== uploadProfilePhoto START ===');
    ('User ID:', req.params.userId);
    ('File:', req.file ? 'Present' : 'Missing');

    const { userId } = req.params;

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if file is provided
    if (!req.file) {
      return res.status(400).json({ message: "No photo file provided" });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Invalid file type. Only JPEG, PNG files are allowed" });
    }

    // Upload to Azure
    ('Uploading to Azure...');
    const relativePath = await uploadToAzure(req.file.buffer, req.file.originalname, 'hrms-profile-photos/');
    ('File uploaded to:', relativePath);

    ('Relative path:', relativePath);

    // Update user profile photo with relative path only
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePhoto: relativePath },
      { new: true }
    ).select('-password');

    ('Profile photo updated successfully');
    ('Saved profilePhoto value:', updatedUser.profilePhoto);

    // Convert to full URL for response only
    const transformedPaths = transformDocumentPaths({ profilePhoto: relativePath });
    const fullPhotoUrl = transformedPaths.profilePhoto;

    res.status(200).json({
      message: 'Profile photo uploaded successfully',
      user: updatedUser,
      photoUrl: fullPhotoUrl
    });
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    res.status(500).json({
      message: 'Failed to upload profile photo',
      error: error.message
    });
  }
});

module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  login,
  changePassword,
  forgotPassword,
  verifyOtp,
  bulkUpload,
  getUserHistory,
  getUserByTlId,
  approveUser,
  updateUserCifForm,
  requestSectionApproval,
  getSectionApprovalStatus,
  sectionApprovalByToken,
  uploadProfilePhoto,
  getAllUsersForMeeting,
};

// --- Utility: catchAsync (Place in src/utility/catchAsync.js) ---
/*
// src/utility/catchAsync.js
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

module.exports = catchAsync;
*/
