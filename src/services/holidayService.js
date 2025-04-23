const Holiday = require('../models/holidayModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

const logger = {
  info: console.log(),
  warn: console.warn(),
  error: console.error(),
  debug: console.debug(),
};

class holidayService {
  /**
   * Create a new holiday (HR/Admin only).
   * @param {object} holidayData - Validated holiday data (includes name, date, createdBy).
   * @returns {Promise<Holiday>} - The created holiday document.
   * @throws {ApiError} - If a holiday already exists on the given date.
   */
  async createHoliday(holidayData) {
    const existingHoliday = await Holiday.findOne({
      date: holidayData.date,
      isDeleted: false,
    });

    if (existingHoliday) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'A holiday on the same date is already declared.'
      );
    }

    const newHoliday = new Holiday(holidayData);
    return await newHoliday.save();
  }

  /**
   * Get all holidays (excluding soft-deleted ones).
   * @returns {Promise<Holiday[]>} - List of all non-deleted holidays, sorted by date.
   */
  async getAllHoliday() {
    const holidays = await Holiday.find({ isDeleted: { $ne: true } }).sort({
      date: 1,
    });

    if (!holidays || holidays?.length === 0) {
      return holidays;
    }

    return holidays;
  }

  /**
   * Get a holiday by its ID.
   * @param {Object} params - Object containing the holiday ID.
   * @param {String} params.id - MongoDB ObjectId.
   * @returns {Promise<Holiday>} - The found holiday.
   * @throws {ApiError} - If no holiday is found with the given ID.
   */
  async getHolidayById({ id }) {
    const result = await Holiday.findById(id);
    if (!result || result?.isDeleted) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'No holiday on given date found'
      );
    }
    return result;
  }

  /**
   * Update a holiday by its ID
   * @param {String} id - MongoDB ObjectId
   * @param {Object} updateData - Validated update data
   * @returns {Promise<Holiday|null>}
   */
  async updateHoliday(holidayData) {
    const oldHoliday = await Holiday.findOne({
      _id: holidayData?.holidayId,
      isDeleted: false,
    });
    if (!oldHoliday) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No holiday found.');
    }
    oldHoliday.name = holidayData?.name;
    oldHoliday.date = holidayData?.date;
    return await oldHoliday.save();
  }

  /**
   * Soft delete a holiday by its ID.
   * @param {Object} params - Object containing the holiday ID.
   * @param {string} params.id - The MongoDB ObjectId of the holiday to delete.
   * @returns {Promise<Holiday>} - The updated holiday with isDeleted set to true.
   * @throws {ApiError} - If the holiday doesn't exist or is already deleted.
   */
  async deleteHoliday({ id }) {
    const result = await Holiday.findById(id);
    if (!result || result?.isDeleted) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'No holiday on given date found'
      );
    }
    result.isDeleted = true;
    return await result.save();
  }
}

module.exports = new holidayService();
