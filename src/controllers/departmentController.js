const httpStatus = require('http-status-codes');
const departmentService = require('../services/departmentService');
const departmentValidator = require('../validators/departmentValidator');
const ApiError = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');

const createDepartment = catchAsync(async (req, res) => {
  const name = req.body.name;
  const description = req.body.description;
  const userId = req.user.id;

  const validatedData =
    await departmentValidator.createDepartmentSchema.validateAsync({
      name: name,
      description: description,
      userId: userId,
    });

  const data = await departmentService.createDepartment(validatedData);
  res.status(httpStatus.CREATED).json({
    status: true,
    message: 'Department created successfully!',
    data: data,
  });
});

// Get all department
const getAllDepartment = catchAsync(async (req, res) => {
  const departments = await departmentService.getAllDepartment();

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Departments retrieved successfully.',
    data: departments,
  });
});

// Get department by Id
const getDepartmentById = catchAsync(async (req, res) => {
  const validatedData =
    await departmentValidator.departmentIdSchema.validateAsync({
      id: req.params.id,
    });
  const departmentFound =
    await departmentService.getDepartmentById(validatedData);
  if (!departmentFound) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Department not found.');
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Department retrieved successfully.',
    data: departmentFound,
  });
});

// Update department
const updateDepartment = catchAsync(async (req, res) => {
  const departmentId = req.params.id;
  const name = req.body.name;
  const description = req.body.description;
  const edittorId = req.user.id;
  const validatedData =
    await departmentValidator.updateDepartmentSchema.validateAsync({
      departmentId,
      name,
      description,
      edittorId,
    });
  const updated = await departmentService.updateDepartment(validatedData);

  if (!updated) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Department not found or update failed.'
    );
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Department updated successfully.',
    data: updated,
  });
});

const deleteDepartment = catchAsync(async (req, res) => {
  const validatedData =
    await departmentValidator.departmentIdSchema.validateAsync({
      id: req.params.id,
    });
  const deleted = await departmentService.deleteDepartment(validatedData);
  if (!deleted) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Department not found.');
  }

  res.status(httpStatus.OK).json({
    status: true,
    message: 'Department deleted successfully.',
    data: deleted,
  });
});

module.exports = {
  createDepartment,
  getAllDepartment,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
};
