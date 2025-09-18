const PersonalEvent = require('../models/personalEventModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

class PersonalEventService {
  /**
   * Create a new personal event
   * @param {object} eventData - Event data (includes title, date, userId, etc.)
   * @returns {Promise<PersonalEvent>} - The created event document
   */
  async createPersonalEvent(eventData) {
    const newEvent = new PersonalEvent(eventData);
    return await newEvent.save();
  }

  /**
   * Get all personal events for a user
   * @param {string} userId - User ID
   * @param {Date} startDate - Start date for filtering (optional)
   * @param {Date} endDate - End date for filtering (optional)
   * @returns {Promise<PersonalEvent[]>} - List of user's personal events
   */
  async getPersonalEventsByUserId(userId, startDate = null, endDate = null) {
    const query = {
      userId: userId,
      isDeleted: { $ne: true }
    };

    if (startDate && endDate) {
      query.date = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const events = await PersonalEvent.find(query).sort({ date: 1 });
    return events;
  }

  /**
   * Get personal events for a specific month
   * @param {string} userId - User ID
   * @param {number} year - Year
   * @param {number} month - Month (0-11)
   * @returns {Promise<PersonalEvent[]>} - List of events for the month
   */
  async getPersonalEventsByMonth(userId, year, month) {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    return await this.getPersonalEventsByUserId(userId, startDate, endDate);
  }

  /**
   * Get a personal event by ID
   * @param {string} eventId - Event ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<PersonalEvent>} - The found event
   * @throws {ApiError} - If event not found or user not authorized
   */
  async getPersonalEventById(eventId, userId) {
    const event = await PersonalEvent.findOne({
      _id: eventId,
      userId: userId,
      isDeleted: { $ne: true }
    });

    if (!event) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Personal event not found');
    }

    return event;
  }

  /**
   * Update a personal event
   * @param {string} eventId - Event ID
   * @param {string} userId - User ID (for authorization)
   * @param {object} updateData - Data to update
   * @returns {Promise<PersonalEvent>} - The updated event
   * @throws {ApiError} - If event not found or user not authorized
   */
  async updatePersonalEvent(eventId, userId, updateData) {
    const event = await PersonalEvent.findOneAndUpdate(
      {
        _id: eventId,
        userId: userId,
        isDeleted: { $ne: true }
      },
      updateData,
      { new: true, runValidators: true }
    );

    if (!event) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Personal event not found');
    }

    return event;
  }

  /**
   * Delete a personal event (soft delete)
   * @param {string} eventId - Event ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<PersonalEvent>} - The deleted event
   * @throws {ApiError} - If event not found or user not authorized
   */
  async deletePersonalEvent(eventId, userId) {
    const event = await PersonalEvent.findOneAndUpdate(
      {
        _id: eventId,
        userId: userId,
        isDeleted: { $ne: true }
      },
      { isDeleted: true },
      { new: true }
    );

    if (!event) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Personal event not found');
    }

    return event;
  }
}

module.exports = new PersonalEventService();
