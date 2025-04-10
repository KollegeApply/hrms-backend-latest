// src/services/userService.js
const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const Helper = require('../utility/helper');
const { paginate } = require('../utility/common'); // Ensure common.js is created
const ApiError = require('../utility/ApiError'); // You might need to create this utility
const { default: httpStatus } = require('http-status'); // Install http-status: npm install http-status

// Basic console logger (replace with Pino or Winston if complex logging is needed)
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.log,
};

class UserService {
  /**
   * Get users with pagination and filtering.
   * @param {object} queryOptions - Options from the validated query parameters.
   * @returns {Promise<object>} - Paginated user data or list of all users.
   */
  async getAllUsers(queryOptions) {
    const {
      page,
      limit,
      search,
      role,
      status,
      sortBy,
      sortOrder,
      isPaginated,
    } = queryOptions;

    const query = { isDeleted: false }; // Base query to exclude soft-deleted users

    // Add search criteria
    if (search) {
      // Simple search across multiple fields (adjust fields as needed)
      const searchRegex = new RegExp(search, 'i'); // Case-insensitive search
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { employeeId: searchRegex },
        { jobTitle: searchRegex },
        { department: searchRegex },
      ];
    }

    // Add filtering criteria
    if (role) {
      query.role = role;
    }
    if (status) {
      query.status = status;
    }

    // Define sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    if (isPaginated) {
      logger.info(
        `Fetching paginated users: page=${page}, limit=${limit}, query=${JSON.stringify(query)}, sort=${JSON.stringify(sort)}`
      );
      // Use the paginate utility function
      return await paginate(User, query, page, limit, sort);
    } else {
      logger.info(
        `Fetching all users: query=${JSON.stringify(query)}, sort=${JSON.stringify(sort)}`
      );
      // Fetch all matching users without pagination
      const users = await User.find(query).sort(sort);
      return { data: users }; // Return in a structure consistent with pagination
    }
  }

  /**
   * Get a single user by their ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @returns {Promise<User|null>} - The user document or null if not found.
   */
  async getUserById(id) {
    logger.info(`Fetching user by ID: ${id}`);
    const user = await User.findOne({ _id: id, isDeleted: false });
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
    });
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
    logger.info(`Attempting to create user with email: ${userData.email}`);
    // Check for existing email
    if (await this.getUserByEmail(userData.email)) {
      logger.warn(`Email already in use: ${userData.email}`);
      throw new ApiError(
        httpStatus.CONFLICT,
        'Email address is already registered.'
      );
    }

    // Check for existing employee ID if provided
    if (
      userData.employeeId &&
      (await this.getUserByEmployeeId(userData.employeeId))
    ) {
      logger.warn(`Employee ID already in use: ${userData.employeeId}`);
      throw new ApiError(httpStatus.CONFLICT, 'Employee ID is already in use.');
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(userData.password, 10); // 10 is the salt rounds

    // Create and save the new user
    const user = new User({
      ...userData,
      password: hashedPassword,
      email: userData.email.toLowerCase(), // Store email in lowercase
    });
    const savedUser = await user.save();
    logger.info(`User created successfully with ID: ${savedUser.id}`);

    // Return user object without password (using toJSON transform)
    return savedUser.toJSON();
  }

  /**
   * Update an existing user by ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @param {object} updateData - Validated data to update.
   * @returns {Promise<User|null>} - The updated user document or null if not found.
   * @throws {ApiError} - Throws error if email or employeeId conflict occurs.
   */
  async updateUser(id, updateData) {
    logger.info(`Attempting to update user with ID: ${id}`);
    const user = await this.getUserById(id); // Use getUserById to ensure user exists and is not deleted

    if (!user) {
      logger.warn(`Update failed: User not found with ID: ${id}`);
      return null; // Or throw ApiError(httpStatus.NOT_FOUND, 'User not found')
    }

    // Check for email conflict if email is being updated
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase();
      const existingUser = await this.getUserByEmail(updateData.email);
      if (existingUser && existingUser.id !== id) {
        logger.warn(
          `Update conflict: Email ${updateData.email} already in use by user ${existingUser.id}`
        );
        throw new ApiError(
          httpStatus.CONFLICT,
          'Email address is already registered by another user.'
        );
      }
    }

    // Check for employee ID conflict if employeeId is being updated
    if (updateData.employeeId) {
      const existingUser = await this.getUserByEmployeeId(
        updateData.employeeId
      );
      if (existingUser && existingUser.id !== id) {
        logger.warn(
          `Update conflict: Employee ID ${updateData.employeeId} already in use by user ${existingUser.id}`
        );
        throw new ApiError(
          httpStatus.CONFLICT,
          'Employee ID is already in use by another user.'
        );
      }
    }

    // Prevent password update through this method (should have a dedicated password reset/change flow)
    delete updateData.password;

    // Apply updates
    Object.assign(user, updateData);
    const updatedUser = await user.save();

    logger.info(`User updated successfully: ${updatedUser.id}`);
    return updatedUser.toJSON();
  }

  /**
   * Soft delete a user by ID.
   * @param {string} id - The user's MongoDB ObjectId.
   * @returns {Promise<boolean>} - True if deletion was successful, false otherwise.
   */
  async deleteUser(id) {
    logger.info(`Attempting to soft delete user with ID: ${id}`);
    const result = await User.findByIdAndUpdate(
      id,
      { isDeleted: true, status: 'inactive' }, // Mark as deleted and inactive
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

    // Compare provided password with the stored hash
    console.log('Plain password:', password);
    console.log('Hashed password in DB:', user.password);

    const isPasswordMatch = await bcrypt.compare(password, user.password);

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

  // --- Placeholder for future methods ---
  // async changePassword(userId, oldPassword, newPassword) { ... }
  // async requestPasswordReset(email) { ... } // (generateAndSendOtp equivalent)
  // async resetPasswordWithToken(token, newPassword) { ... } // (verifyOtp equivalent)
}

module.exports = new UserService(); // Export an instance
