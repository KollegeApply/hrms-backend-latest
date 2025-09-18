const announcementService = require('../services/announcementService');
const { ApiError } = require('../utility/ApiError');
const catchAsync = require('../utility/catchAsync');
const announcementValidator = require('../validators/announcementValidator');

const createAnnouncement = catchAsync(async (req, res) => {
  const validatedData = await announcementValidator.createAnnouncementSchema.validateAsync(req.body);
  
  const announcementData = {
    ...validatedData,
    createdBy: req.user.id
  };

  const announcement = await announcementService.createAnnouncement(announcementData);

  res.status(201).json({
    success: true,
    message: 'Announcement created successfully',
    data: announcement
  });
});

const getAnnouncements = catchAsync(async (req, res) => {
  const validatedQuery = await announcementValidator.getAnnouncementsSchema.validateAsync(req.query);
  
  const result = await announcementService.getAnnouncements(validatedQuery, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Announcements fetched successfully',
    data: result.announcements,
    pagination: {
      currentPage: result.page,
      totalPages: result.totalPages,
      totalItems: result.total,
      itemsPerPage: validatedQuery.limit
    }
  });
});

const getAnnouncementById = catchAsync(async (req, res) => {
  const validatedParams = await announcementValidator.announcementIdSchema.validateAsync(req.params);
  const announcement = await announcementService.getAnnouncementById(validatedParams.id);

  res.status(200).json({
    success: true,
    message: 'Announcement fetched successfully',
    data: announcement
  });
});

const updateAnnouncement = catchAsync(async (req, res) => {
  const validatedParams = await announcementValidator.announcementIdSchema.validateAsync(req.params);
  const validatedData = await announcementValidator.updateAnnouncementSchema.validateAsync(req.body);
  
  const announcement = await announcementService.updateAnnouncement(
    validatedParams.id, 
    validatedData, 
    req.user.id
  );

  res.status(200).json({
    success: true,
    message: 'Announcement updated successfully',
    data: announcement
  });
});

const deleteAnnouncement = catchAsync(async (req, res) => {
  const validatedParams = await announcementValidator.announcementIdSchema.validateAsync(req.params);
  
  await announcementService.deleteAnnouncement(validatedParams.id, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Announcement deleted successfully'
  });
});

const getUserAnnouncements = catchAsync(async (req, res) => {
  const validatedQuery = await announcementValidator.getAnnouncementsSchema.validateAsync(req.query);
  
  const result = await announcementService.getAnnouncementsByUser(req.user.id, validatedQuery);

  res.status(200).json({
    success: true,
    message: 'User announcements fetched successfully',
    data: result.announcements,
    pagination: {
      currentPage: result.page,
      totalPages: result.totalPages,
      totalItems: result.total,
      itemsPerPage: validatedQuery.limit
    }
  });
});

module.exports = {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  getUserAnnouncements
};