const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const {
  paginate,
  validateHeaders,
  validateUsersCsvFile,
  autoGenerateEmpId,
} = require('../utility/common'); // Ensure common.js is created
const ApiError = require('../utility/ApiError'); // You might need to create this utility
const { default: httpStatus } = require('http-status'); // Install http-status: npm install http-status
const logger = require('../config/logger');
const {
  OTP_EXPIRY_MINUTES,
  USER_CSV_FILE_HEADERS,
} = require('../utility/constants');
const { default: mongoose } = require('mongoose');
const csv = require('csvtojson');
const Department = require('../models/departmentModel');
const {
  calculateProbationLeave,
  calculateOnRollLeave,
} = require('../utility/leaveCalculation');
const employeeHistory = require('../models/employeeHistory');

class UserService {
  /**
   * Get users with pagination and filtering.
   *
   * @param {object} queryOptions - Options from the validated query parameters.
   * @param {object} currentUser - The currently logged-in user's data.
   * @param {string} currentUser.id - The ID of the current user.
   * @param {string} currentUser.role - The role of the current user (e.g., 'admin', 'teamlead').
   * @returns {Promise<object>} - Paginated user data or list of all users.
   */

  async getAllUsers(queryOptions, currentUser) {
    const {
      page,
      limit,
      search,
      department,
      role,
      status,
      sortBy,
      sortOrder,
      isPaginated,
    } = queryOptions;

    const query = { isDeleted: false }; // Base query to exclude soft-deleted users

    if (
      department &&
      typeof department === 'string' &&
      department?.trim()?.length > 0
    ) {
      // Assuming 'department' field in User schema stores the ObjectId
      query.department = department?.trim();
      logger.info(`Applying department filter: ${query.department}`);
    }

    // Add search criteria
    if (search && typeof search === 'string' && search?.trim()?.length > 0) {
      const searchTerm = search?.trim();
      // Simple search across multiple fields (adjust fields as needed)
      const searchRegex = new RegExp(searchTerm, 'i'); // Case-insensitive search
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { employeeId: searchRegex },
        // { jobTitle: searchRegex },
        // { department: searchRegex },
      ];
    }

    // Add filtering criteria
    if (role) {
      query.role = role;
    }
    if (status) {
      query.status = status;
    }

    // Restrict user from seeing their own record
    // query._id = { $ne: currentUser.id };

    // Define sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const populateOptions = [
      {
        path: 'teamLeadId',
        select: 'id firstName lastName email',
      },
      {
        path: 'subTeamLeadId',
        select: '_id firstName lastName email',
      },
      {
        path: 'department',
        select: '_id name',
      },
    ];

    if (isPaginated) {
      logger.info(
        `Fetching paginated users: page=${page}, limit=${limit}, query=${JSON.stringify(query)}, sort=${JSON.stringify(sort)}`
      );
      const paginatedResult = await paginate(
        User,
        query,
        page,
        limit,
        sort,
        null,
        populateOptions
      );

      return paginatedResult;
    } else {
      logger.info(
        `Fetching all users: query=${JSON.stringify(query)}, sort=${JSON.stringify(sort)}`
      );
      // Fetch all matching users without pagination
      const users = await User.find(query).sort(sort);
      return { data: users };
    }
  }

  /**
   * Get a single user by their ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @returns {Promise<User|null>} - The user document or null if not found.
   */
  async getUserById(id) {
    logger.info(`Fetching user by ID: ${id}`);
    const user = await User.findOne({ _id: id, isDeleted: false })
      .populate('department', 'name')
      .populate('teamLeadId', 'firstName lastName')
      .populate('subTeamLeadId', 'firstName lastName')
      .populate('hrPocId', 'firstName lastName email');
    if (!user) {
      logger.warn(`User not found with ID: ${id}`);
    }
    return user;
  }

  /**
   * Get a single user by their email.
   * @param {string} email - The user's email address.
   * @returns {Promise<User|null>} - The user document or null if not found.
   */
  async getUserByEmail(email) {
    logger.info(`Fetching user by email: ${email}`);
    // Find user who is not deleted
    const user = await User.findOne({
      email: email.toLowerCase(),
      isDeleted: false,
    }).select('+password'); // Include password for authentication checks
    if (!user) {
      logger.debug(`User not found with email: ${email}`);
    }
    return user;
  }

  /**
   * Get a single user by their employee ID.
   * @param {string} employeeId - The user's employee ID.
   * @returns {Promise<User|null>} - The user document or null if not found.
   */
  async getUserByEmployeeId(employeeId) {
    logger.info(`Fetching user by employeeId: ${employeeId}`);
    // Find user who is not deleted
    const user = await User.findOne({
      employeeId: employeeId,
      isDeleted: false,
    }).populate('department', 'name');
    if (!user) {
      logger.debug(`User not found with employeeId: ${employeeId}`);
    }
    return user;
  }

  /**
   * Create a new user.
   * @param {object} userData - Validated user data from the request.
   * @returns {Promise<User>} - The newly created user document.
   * @throws {ApiError} - Throws error if email or employeeId is already in use.
   */
  async createUser(userData) {
    logger.info(`Attempting to create user with email: ${userData?.email}`);

    // Check for existing email
    if (await this.getUserByEmail(userData?.email)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Email address is already registered.'
      );
    }

    // Check for existing employee ID
    if (
      userData?.employeeId &&
      (await this.getUserByEmployeeId(userData?.employeeId))
    ) {
      throw new ApiError(httpStatus.CONFLICT, 'Employee ID is already in use.');
    }

    // Validate IDs (Team Lead, Sub Team Lead, HR POC)
    const idsToValidate = [
      { id: userData?.teamLeadId, label: 'Team Lead' },
      { id: userData?.subTeamLeadId, label: 'Sub Team Lead' },
      { id: userData?.hrPocId, label: 'HR' },
    ];

    for (const { id, label } of idsToValidate) {
      if (id) {
        const userExists = await this.getUserById(id);
        if (!userExists)
          throw new ApiError(httpStatus.NOT_FOUND, `${label} not found`);
      }
    }

    // Auto-generate Employee ID
    const lastUser = await User.findOne({ employeeId: { $regex: /^SD_\d+$/ } })
      .sort({ employeeId: -1 })
      .select('employeeId')
      .lean();
    const nextNumber = autoGenerateEmpId(lastUser);
    const paddedNumber = String(nextNumber).padStart(3, '0');

    // Hash the password
    const hashedPassword = await bcrypt.hash(userData?.password, 10);

    // Validate Work Type
    if (!['WFH', 'WFO'].includes(userData?.workType)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid workType. Allowed values are "WFH" or "WFO".'
      );
    }

    // Determine Join Date
    const hireDate = userData?.hireDate
      ? new Date(userData.hireDate)
      : new Date();

    let leaveStructure = {};
    if (userData.status === 'probation') {
      leaveStructure.perMonth = 1;
      leaveStructure.carryForwardLeave = {
        total: 0,
      };
    } else if (userData.status === 'onroll') {
      leaveStructure = calculateOnRollLeave(hireDate);
    } else {
      leaveStructure = {};
    }

    // Create and Save User
    const user = new User({
      ...userData,
      employeeId: `SD_${paddedNumber}`,
      password: hashedPassword,
      email: userData?.email?.toLowerCase(),
      leaves: leaveStructure,
    });

    const savedUser = await user.save();
    logger.info(`User created successfully with ID: ${savedUser?.id}`);
    return savedUser.toJSON();
  }

  /**
   * Update an existing user by ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @param {object} updateData - Validated data to update.
   * @returns {Promise<User|null>} - The updated user document or null if not found.
   * @throws {ApiError} - Throws error if email or employeeId conflict occurs.
   */
  async updateUser(id, updateData, changedByUser) {
    logger.info(`Attempting to update user with ID: ${id}`);
    const user = await this.getUserById(id); // Use getUserById to ensure user exists and is not deleted

    if (!user) {
      logger.warn(`Update failed: User not found with ID: ${id}`);
      return null; // Or throw ApiError(httpStatus.NOT_FOUND, 'User not found')
    }

    const oldUser = user.toObject();

    // Check for email conflict if email is being updated
    updateData.email = updateData?.email?.toLowerCase();
    const existingUser = await this.getUserByEmail(updateData?.email);
    if (updateData?.email) {
      if (existingUser && existingUser?.id !== id) {
        logger.warn(
          `Update conflict: Email ${updateData?.email} already in use by user ${existingUser.id}`
        );
        throw new ApiError(
          httpStatus.CONFLICT,
          'Email address is already registered by another user.'
        );
      }
    }

    // Check for employee ID conflict if employeeId is being updated
    if (updateData?.employeeId) {
      const existingUser = await this.getUserByEmployeeId(
        updateData?.employeeId
      );
      if (existingUser && existingUser?.id !== id) {
        logger.warn(
          `Update conflict: Employee ID ${updateData?.employeeId} already in use by user ${existingUser?.id}`
        );
        throw new ApiError(
          httpStatus.CONFLICT,
          'Employee ID is already in use by another user.'
        );
      }
    }

    // Prevent password update through this method (should have a dedicated password reset/change flow)
    delete updateData?.password;

    const validWorkTypes = ['WFO', 'WFH'];
    if (updateData?.workType && !validWorkTypes.includes(updateData.workType)) {
      logger.warn(`Update failed: Invalid work type ${updateData.workType}`);
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid work type. Valid options are WFO and WFH.'
      );
    }

    // **Detect status change**
    const oldStatus = oldUser.status;
    const newStatus = updateData.status || oldStatus;

    if (oldStatus !== newStatus) {
      const today = new Date();
      const hireDate = user.hireDate ? new Date(user.hireDate) : today;

      // If status changed from probation → onroll
      if (oldStatus === 'probation' && newStatus === 'onroll') {
        const onRollLeaves = calculateOnRollLeave(today);

        // Add old carryForwardLeave to new one
        const existingCarry = oldUser?.leaves?.carryForwardLeave?.total || 0;
        onRollLeaves.carryForwardLeave.total += existingCarry;

        // Optional: also update `.total` if you want to reflect it
        onRollLeaves.total += existingCarry;

        updateData.leaves = onRollLeaves;
      } else if (oldStatus === 'onroll' && newStatus === 'probation') {
        updateData.leaves = {
          perMonth: 1,
          carryForwardLeave: {
            total: 0,
          },
        };
      }
    }

    // Handle empty string for hrPocId
    if (updateData?.hrPocId === '') {
      updateData.hrPocId = undefined;
    } else if (updateData?.hrPocId) {
      // Optionally, you could validate the existence of the HR here if needed
      try {
        const hrExist = await this.getUserById(updateData?.hrPocId);
        if (!hrExist) {
          logger.warn(
            `Update failed: HR not found with ID: ${updateData?.hrPocId}`
          );
          throw new ApiError(httpStatus.NOT_FOUND, 'HR not found');
        }
      } catch (err) {
        if (err instanceof ApiError) {
          throw err;
        }
        logger.error(
          `Error validating HR with ID ${updateData?.hrPocId}: ${err}`
        );
        throw new ApiError(
          httpStatus.INTERNAL_SERVER_ERROR,
          'Failed to validate HR'
        );
      }
    }

    // Apply updates
    Object.assign(user, updateData);
    const updatedUser = await user.save();

    logger.info(`User updated successfully: ${updatedUser?.id}`);

    // Find changed fields except some exclusions
    const includedFields = ['jobTitle', 'role', 'status'];

    const changedFields = Object.keys(updateData).filter(
      (f) => includedFields.includes(f) && oldUser[f] !== updatedUser[f]
    );

    await Promise.all(
      changedFields.map((field) =>
        employeeHistory.create({
          employeeId: updatedUser._id,
          entity: field,
          previous: oldUser[field] || null,
          changed: updatedUser[field] || null,
          changedBy: changedByUser._id,
          actionAt: new Date(),
        })
      )
    );

    return updatedUser.toJSON();
  }

  /**
   * Soft delete a user by ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @returns {Promise<boolean>} - True if deletion was successful, false otherwise.
   */
  async deleteUser(id) {
    logger.info(`Attempting to soft delete user with ID: ${id}`);
    const result1 = await User.findById(id);
    console.log(result1);
    if (result1.isDeleted) {
      return false;
    }
    const result = await User.findByIdAndUpdate(
      id,
      { isDeleted: true }, // Mark as deleted
      { new: true } // Option not strictly needed for deletion check but good practice
    );

    if (result) {
      logger.info(`User soft deleted successfully: ${id}`);
      return true;
    } else {
      logger.warn(`Soft delete failed: User not found with ID: ${id}`);
      return false;
    }
  }

  /**
   * Authenticate a user by email and password.
   * @param {string} email - User's email.
   * @param {string} password - User's password.
   * @returns {Promise<User|null>} - The authenticated user document (without password) or null.
   */
  async authenticateUser(email, password) {
    logger.debug(`Attempting authentication for email: ${email}`);
    const user = await this.getUserByEmail(email); // Fetches user with password included

    if (!user) {
      logger.warn(`Authentication failed: User not found for email: ${email}`);
      return null; // User not found
    }

    if (
      user?.status === 'terminated' ||
      user?.status === 'absconded' ||
      user?.status === 'resigned'
    ) {
      logger.warn(`User is terminated or absconded or resigned`);
      return null;
    }

    // Compare provided password with the stored hash
    // console.log('Plain password:', password);
    // console.log('Hashed password in DB:', user.password);

    const isPasswordMatch = await bcrypt.compare(password, user?.password);

    if (!isPasswordMatch) {
      logger.warn(
        `Authentication failed: Invalid password for email: ${email}`
      );
      return null; // Incorrect password
    }

    logger.info(`Authentication successful for user: ${user.id}`);
    // Return user object without the password field
    return user.toJSON();
  }

  /**
   * Allows an authenticated user to change their own password.
   * @param {string} userId - The ID of the user changing the password.
   * @param {string} oldPassword - The user's current password.
   * @param {string} newPassword - The desired new password.
   * @returns {Promise<boolean>} - True if the password was changed successfully.
   * @throws {ApiError} - If user not found, old password mismatch, or update fails.
   */
  async changePassword(userId, oldPassword, newPassword) {
    logger.info(`Attempting password change for user ID: ${userId}`);

    // Fetch user *with* password selected
    const user = await User.findById(userId).select('+password');

    if (!user || user?.isDeleted) {
      logger.warn(
        `Password change failed: User not found or deleted for ID: ${userId}`
      );
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    // Verify the old password
    const isPasswordMatch = await bcrypt.compare(oldPassword, user?.password);
    if (!isPasswordMatch) {
      logger.warn(
        `Password change failed: Incorrect old password for user ID: ${userId}`
      );
      throw new ApiError(
        httpStatus.UNAUTHORIZED,
        'Incorrect current password.'
      );
    }

    // Hash the new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    logger.info(`Password changed successfully for user ID: ${userId}`);
    // Optionally: Send an email notification about the password change
    return true;
  }

  /**
   * Generates a password reset OTP and sends it via email.
   * @param {string} email - The email address of the user requesting the reset.
   * @returns {Promise<void>}
   * @throws {Error} - Propagates email sending errors if needed.
   */
  async requestPasswordReset(email) {
    logger.info(`Password reset requested for email: ${email}`);
    // Fetch user *including* OTP fields for potential overwriting
    const user = await User.findOne({
      email: email?.toLowerCase(),
      isDeleted: false,
    }).select('+passwordResetOtp +passwordResetOtpExpires');

    // IMPORTANT: Always return successfully, even if user doesn't exist, to prevent email enumeration attacks.
    if (!user) {
      logger.warn(
        `Password reset requested for non-existent or deleted email: ${email}. No action taken.`
      );
      return; // Silently exit
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000); // Set expiry time

    // Save OTP and expiry to the user document
    user.passwordResetOtp = otp;
    user.passwordResetOtpExpires = otpExpires;
    await user.save();

    logger.info(
      `Generated OTP ${otp} for user ${user?.id}, expires at ${otpExpires}`
    );

    try {
      await Helper.sendEmail({
        receiverEmails: [user?.email],
        subject: 'HRMS Password Reset OTP',
        message: Helper.getOTPEmail(otp), // Use the OTP email template
      });
      logger.info(
        `Password reset OTP email sent successfully to: ${user?.email}`
      );
    } catch (error) {
      logger.error(
        `Failed to send password reset OTP email to ${user?.email}:`,
        error
      );
      // Consider cleaning up OTP fields if email fails critically?
      // user.passwordResetOtp = undefined;
      // user.passwordResetOtpExpires = undefined;
      // await user.save();
      // Decide if you want to throw the error or just log it
      // throw new Error('Failed to send password reset OTP email.');
    }
  }

  /**
   * Verifies the OTP and resets the user's password.
   * @param {string} email - The user's email address.
   * @param {string} otp - The OTP provided by the user.
   * @param {string} newPassword - The desired new password.
   * @returns {Promise<boolean>} - True if password reset was successful.
   * @throws {ApiError} - If OTP is invalid/expired, user not found, or update fails.
   */
  async verifyOtpAndResetPassword(email, newPassword, otp) {
    logger.info(`Attempting password reset via OTP for email: ${email}`);

    // Find the user, selecting the necessary fields
    const user = await User.findOne({
      email: email?.toLowerCase(),
      isDeleted: false,
      // Ensure OTP hasn't already been used/cleared and hasn't expired
      passwordResetOtp: otp, // Directly match the OTP
      passwordResetOtpExpires: { $gt: new Date() }, // Check expiry
    }).select('+password +passwordResetOtp +passwordResetOtpExpires'); // Select fields for update and verification

    // Check if a user was found matching the email, OTP, and expiry criteria
    if (!user) {
      logger.warn(
        `Password reset failed: Invalid OTP, expired OTP, or user not found for email: ${email}`
      );
      // It's crucial to give a generic error here to prevent leaking info about whether the email exists or if the OTP was just wrong/expired.
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or expired OTP.');
    }

    // --- OTP is valid and user found ---

    // Hash and set the new password
    user.password = await bcrypt.hash(newPassword, 10);

    // Clear the OTP fields after successful use
    user.passwordResetOtp = undefined;
    user.passwordResetOtpExpires = undefined;

    await user?.save();

    logger.info(`Password reset via OTP successful for user ID: ${user?.id}`);
    // Optionally: Send confirmation email that password was changed
    return true;
  }

  async bulkUpload(usersFile, activity) {
    try {
      // Parse CSV
      const fileInString = usersFile?.buffer?.toString('utf-8');
      const usersCsvJson = await csv()?.fromString(fileInString);

      if (!usersCsvJson?.length) {
        return {
          status: false,
          code: 400,
          message: 'CSV file is empty or invalid.',
          isErrorForUser: true,
        };
      }

      // Validate Headers
      const { status: headerStatus, message: headerMessage } = validateHeaders(
        USER_CSV_FILE_HEADERS,
        usersCsvJson[0]
      );
      if (!headerStatus) {
        return {
          status: false,
          code: 400,
          message: headerMessage || 'Invalid CSV headers.',
          isErrorForUser: true,
        };
      }

      // logic to convert department name,teamlead and subteamlead email to there objectId
      let departmentName = [];
      let tlName = [];
      let stlName = [];
      for (let user of usersCsvJson) {
        departmentName.push(user?.department?.trim());
        tlName.push(user?.teamLeadId?.trim());
        stlName.push(user?.subTeamLeadId?.trim());
      }

      const uniqueDepartments = [...new Set(departmentName)];
      const uniqueTeamLeads = [...new Set(tlName)];
      const uniqueSubTeamLeads = [...new Set(stlName)];

      // Fetch matching departments
      const departments = await Department.find({
        name: { $in: uniqueDepartments },
      })
        .select('_id name')
        .lean();

      const users = await User.find({
        email: {
          $in: [...new Set([...uniqueTeamLeads, ...uniqueSubTeamLeads])],
        },
      })
        .select('id email')
        .lean();

      const departmentMap = {};
      departments.forEach((dep) => (departmentMap[dep?.name] = dep?._id));

      const userMap = {};
      users.forEach((u) => (userMap[u?.email] = u?._id));

      for (let user of usersCsvJson) {
        user.department = departmentMap[user?.department]?.toString() || null;
        user.teamLeadId = userMap[user?.teamLeadId]?.toString() || null;
        user.subTeamLeadId = userMap[user?.subTeamLeadId]?.toString() || null;
      }

      // Validate Rows & Internal Duplicates
      let { validData, invalidData } = await validateUsersCsvFile(usersCsvJson);

      const augmentedValidationErrors = invalidData.map((item) => {
        const userEmail =
          item?.Email ||
          item?.email ||
          (item?.originalRow ? item?.originalRow?.Email : null);

        const processedItem = { ...item };

        if (userEmail && typeof userEmail === 'string') {
          const trimmedEmail = userEmail.trim();
          processedItem.Email = trimmedEmail;
          if (
            typeof processedItem?.Reason === 'string' &&
            !processedItem.Reason.includes(trimmedEmail)
          ) {
            processedItem.Reason = `Email '${trimmedEmail}': ${processedItem.Reason}`;
          }
        }
        if (!processedItem['#']) {
          processedItem['#'] = 'Validation/Internal Duplicate';
        }

        return processedItem;
      });

      invalidData = augmentedValidationErrors;

      if (validData.length === 0) {
        return {
          status: true,
          code: 200,
          message: 'No valid user data found.',
          data: invalidData,
        };
      }

      // Check DB Duplicates
      const emailsToCheck = validData.map((u) => u?.email);
      // const employeeIdsToCheck = validData.map((u) => u?.employeeId); // Filter falsy IDs

      const existingUsers = await User.find({
        // isDeleted: false,
        email: { $in: emailsToCheck },
      })
        .select('email')
        .lean();

      const existingEmails = new Set(existingUsers?.map((u) => u?.email));
      // const existingEmployeeIds = new Set(
      //   existingUsers.filter((u) => u.employeeId)?.map((u) => u?.employeeId)
      // );

      // Filter out existing users and add them to invalidData
      const usersToInsert = [];
      validData.forEach((user) => {
        let reason = '';
        if (existingEmails.has(user?.email)) {
          reason = `Email '${user?.email}' already exists in DB.`;
        }
        // else if (
        //   user?.employeeId &&
        //   existingEmployeeIds.has(user?.employeeId)
        // ) {
        //   reason = `EmployeeID '${user?.employeeId}' already exists in DB.`;
        // }

        if (reason) {
          // Find original CSV row for context (simplified lookup)
          const originalCsvRow = usersCsvJson?.find(
            (row) => row.Email?.trim()?.toLowerCase() === user?.email
          );
          invalidData.push({
            '#': 'DB Check',
            Reason: reason,
            ...(originalCsvRow || {
              Email: user?.email,
              // EmployeeID: user?.employeeId,
            }),
          });
        } else {
          usersToInsert.push(user);
        }
      });

      if (usersToInsert.length === 0) {
        console.log(`${activity} No new users to insert after DB check.`);
        return {
          status: true,
          code: 200,
          message:
            'No new users to create (all valid rows already exist or had issues).',
          data: invalidData,
        };
      }

      // Hash Passwords
      const saltRounds = 10;
      const usersReadyForInsert = [];
      const lastUser = await User.findOne({
        employeeId: { $regex: /^SD_\d+$/ },
      })
        .sort({ employeeId: -1 })
        .select('employeeId')
        .lean();
      let nextNumber = autoGenerateEmpId(lastUser);
      let passMap = {};
      // const paddedNumber = String(nextNumber).padStart(3, '0');
      for (const user of usersToInsert) {
        try {
          if (!user.password)
            throw new Error('Missing password prior to hashing.');
          const paddedNumber = String(nextNumber++).padStart(3, '0');
          user.employeeId = `SD_${paddedNumber}`;
          passMap[user?.firstName] = user?.password;
          // passMap.set(user?.firstName, user?.password);
          user.password = await bcrypt.hash(user?.password, saltRounds);
          usersReadyForInsert?.push(user);
        } catch (hashError) {
          console.error(
            `${activity} Failed to hash password for ${user?.email}:`,
            hashError
          );
          invalidData.push({
            '#': 'Hashing',
            Reason: `Failed to process password for user ${user?.email}.`,
            Email: user?.email,
          });
        }
      }

      // Bulk Insert
      let createdCount = 0;
      if (usersReadyForInsert?.length > 0) {
        try {
          const result = await User.insertMany(usersReadyForInsert, {
            ordered: false,
          });
          // console.log(result);
          createdCount = result?.length;
          console.log(`${activity} Inserted ${createdCount} users.`);

          for (const user of result) {
            // await sendUserWelcomeEmail(user); // customize this function as needed

            if (
              process?.env?.NODE_ENV === 'production' &&
              process?.env?.HRMS_FRONTEND_URL
            ) {
              logger.info(`Sending welcome email to ${user.email}`);
              Helper.sendEmail({
                receiverEmails: [user?.email],
                subject: `Welcome to ${process?.env?.TEAM} – Let’s Get You Started!`,
                message: Helper.getWelcomeEmail(
                  user?.firstName,
                  user?.email,
                  passMap[user?.firstName],
                  // validatedData?.password,
                  process?.env?.HRMS_FRONTEND_URL
                ),
                fromHr: true,
              }).catch((err) =>
                logger.error(
                  `Failed to send welcome email to ${user?.email}:`,
                  err
                )
              );
            }
          }
        } catch (dbError) {
          console.error(`${activity} Error during User.insertMany:`, dbError);
          invalidData.push({
            '#': 'DB Insert',
            Reason: `Database error during insertion: ${dbError?.message}`,
          });
          // Return failure, but acknowledge partial success is possible with ordered:false
          return {
            status: false, // Indicate potential partial failure
            code: 500,
            message: `Database error during bulk insertion. ${createdCount} users might have been created before the error. Check error report.`,
            data: invalidData,
            isErrorForUser: false,
          };
        }
      }

      // Format Response
      const successMessage =
        createdCount > 0
          ? `Successfully created ${createdCount} users.`
          : 'No new users were created.';
      const finalMessage =
        invalidData?.length > 0
          ? `${successMessage} ${invalidData?.length} rows had issues.`
          : successMessage;

      return {
        status: true,
        code: createdCount > 0 ? 201 : 200,
        message: finalMessage,
        data: invalidData,
      };
    } catch (error) {
      console.error(
        `${activity} Unexpected error in bulkUpload service:`,
        error
      );
      // Throw a generic error for the controller to catch
      throw new Error('Failed to process bulk user upload.');
    }
  }

  async getUserHistory(employeeId) {
    try {
      const historyRecords = await employeeHistory
        .find({ employeeId })
        .populate({
          path: 'changedBy',
          select: 'firstName lastName', // Adjust this as per your User schema fields
        })
        .sort({ actionAt: -1 }) // Sort by most recent changes first
        .lean();

      console.log('history-record', historyRecords);

      return {
        status: true,
        statusCode: 200,
        data: historyRecords,
      };
    } catch (error) {
      console.error('Error in getUserHistory service:', error);
      return {
        status: false,
        statusCode: 500,
        message: 'An unexpected server error occurred.',
      };
    }
  }
}

module.exports = new UserService(); // Export an instance
