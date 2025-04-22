const Department = require('../models/departmentModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

const logger = {
  info: console.log(),
  warn: console.warn(),
  error: console.error(),
  debug: console.debug(),
};

class departmentService {
  async createDepartment(departmentData) {
    const existingDepartment = await Department.findOne({
      name: departmentData.name,
      isDeleted: false,
    });
    if (existingDepartment) {
      throw new ApiError(httpStatus.CONFLICT, 'Department already exist');
    }
    const data = {
      name: departmentData?.name,
      description: departmentData?.description,
      createdBy: departmentData?.userId,
      edittedBy: departmentData?.userId,
    };

    const department = new Department(data);
    return await department.save();
  }

  /**
   * Get all holidays (excluding soft-deleted ones).
   * @returns {Promise<Department[]>} - List of all non-deleted holidays, sorted by date.
   */
  async getAllDepartment() {
    const departments = await Department.find({ isDeleted: false }).sort({
      date: 1,
    });

    if (!departments || departments?.length === 0) {
      return departments;
    }

    return departments;
  }

  /**
   * Get a holiday by its ID.
   * @param {Object} params - Object containing the holiday ID.
   * @param {String} params.id - MongoDB ObjectId.
   * @returns {Promise<Holiday>} - The found holiday.
   * @throws {ApiError} - If no holiday is found with the given ID.
   */
  async getDepartmentById({ id }) {
    const result = await Department.findById(id);
    if (!result || result?.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Department not found');
    }
    return result;
  }

  /**
   * Update a holiday by its ID
   * @param {String} id - MongoDB ObjectId
   * @param {Object} updateData - Validated update data
   * @returns {Promise<Holiday|null>}
   */
  async updateDepartment(departmentData) {
    const oldDepartment = await Department.findOne({
      _id: departmentData?.departmentId,
      isDeleted: false,
    });
    if (!oldDepartment) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No department found.');
    }
    oldDepartment.name = departmentData?.name;
    oldDepartment.description = departmentData?.description;
    oldDepartment.edittedBy = departmentData?.edittorId;
    return await oldDepartment.save();
  }

  /**
   * Soft delete a holiday by its ID.
   * @param {Object} params - Object containing the holiday ID.
   * @param {string} params.id - The MongoDB ObjectId of the holiday to delete.
   * @returns {Promise<Holiday>} - The updated holiday with isDeleted set to true.
   * @throws {ApiError} - If the department doesn't exist or is already deleted.
   */
  async deleteDepartment({ id }) {
    const result = await Department.findById(id);
    if (!result || result?.isDeleted) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Department not found');
    }
    result.isDeleted = true;
    return await result.save();
  }
}
module.exports = new departmentService();
