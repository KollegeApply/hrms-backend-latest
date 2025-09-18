const Announcement = require('../models/announcementModel');
const { ApiError } = require('../utility/ApiError');
const anniversaryAnnouncementService = require('./anniversaryAnnouncementService');

const createAnnouncement = async (announcementData) => {
  try {
    const announcement = new Announcement(announcementData);
    await announcement.save();
    return await announcement.populate([
      { path: 'createdBy', select: 'firstName lastName employeeId' },
      { path: 'departmentId', select: 'name' }
    ]);
  } catch (error) {
    throw new ApiError(400, 'Failed to create announcement');
  }
};

const getAnnouncements = async (filters = {}, userId = null) => {
  try {
    const {
      category,
      departmentId,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = filters;

    const query = {
      isDeleted: false
    };

    // Get user information if userId is provided
    let user = null;
    if (userId) {
      const User = require('../models/userModel');
      user = await User.findById(userId).select('role department team');
      console.log('User found:', user);
    }

    // Add category filter only if category is specified
    if (category && category !== '') {
      query.category = category;
    }

    // Add department filter for department announcements
    if (category === 'department') {
      if (departmentId) {
        // If specific department is requested, filter by that department
        query.departmentId = departmentId;
      }
      // If no specific departmentId, show all department announcements (no additional filter needed)
    }

    // Role-based filtering for regular users
    const isAdminUser = user && ['hr', 'admin', 'subadmin', 'teamlead'].includes(user.role);
    console.log('Is admin user:', isAdminUser, 'User role:', user?.role);
    
    if (user && !isAdminUser) {
      console.log('Applying role-based filtering for regular user');
      // Regular users - show only relevant announcements
      const userDepartments = user?.department ? [user.department] : [];
      
      if (category === 'general') {
        query.category = 'general';
      } else if (category === 'department') {
        query.category = 'department';
        query.$or = [
          { departmentId: { $in: userDepartments } },
          { createdBy: userId }
        ];
      } else {
        // If no specific category, show all relevant announcements
        query.$or = [
          { category: 'general' },
          { 
            category: 'department',
            departmentId: { $in: userDepartments }
          }
        ];
      }
    } else {
      console.log('Skipping role-based filtering for admin user');
    }

    // Team-based filtering: Only show announcements from creators of the same team
    if (user && user.team) {
      console.log('Applying team-based filtering for team:', user.team);
      
      // Get all users from the same team as the current user
      const User = require('../models/userModel');
      const sameTeamUsers = await User.find({ team: user.team }).select('_id');
      const sameTeamUserIds = sameTeamUsers.map(u => u._id);
      
      console.log('Same team user IDs:', sameTeamUserIds.length);
      
      // Add team filter to existing query
      if (query.$or) {
        // If we already have $or conditions (from role-based filtering), wrap them with team filter
        query.$and = [
          { $or: query.$or },
          { createdBy: { $in: sameTeamUserIds } }
        ];
        delete query.$or;
      } else {
        // If no existing $or conditions, just add team filter
        query.createdBy = { $in: sameTeamUserIds };
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    
    // Custom sorting: combine date and time for proper chronological order
    let sort;
    if (sortBy === 'date') {
      // For date sorting, we'll sort by date first, then by time
      sort = { date: sortOrder === 'desc' ? -1 : 1, time: sortOrder === 'desc' ? -1 : 1 };
    } else {
      // For other fields, use regular sorting
      sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    }

    // Debug logging
    console.log('Announcement query:', JSON.stringify(query, null, 2));
    console.log('User role:', user?.role);
    console.log('Category filter:', category);
    console.log('Sort criteria:', sort);
    
    // Check total announcements in database
    const allAnnouncementsInDB = await Announcement.find({}).select('title category isDeleted isActive');
    console.log('All announcements in DB:', allAnnouncementsInDB);

    let announcements = await Announcement.find(query)
      .populate([
        { path: 'createdBy', select: 'firstName lastName employeeId' },
        { path: 'departmentId', select: 'name' }
      ])
      .skip(skip)
      .limit(limit);

    // Apply custom sorting for date+time combination
    if (sortBy === 'date') {
      announcements = announcements.sort((a, b) => {
        // Combine date and time for proper sorting
        const aDateTime = new Date(`${a.date.toISOString().split('T')[0]}T${a.time}`);
        const bDateTime = new Date(`${b.date.toISOString().split('T')[0]}T${b.time}`);
        
        if (sortOrder === 'desc') {
          return bDateTime.getTime() - aDateTime.getTime(); // Newest first
        } else {
          return aDateTime.getTime() - bDateTime.getTime(); // Oldest first
        }
      });
    } else {
      // Apply MongoDB sort for other fields
      announcements = await Announcement.find(query)
        .populate([
          { path: 'createdBy', select: 'firstName lastName employeeId' },
          { path: 'departmentId', select: 'name' }
        ])
        .sort(sort)
        .skip(skip)
        .limit(limit);
    }

    // Get auto-generated anniversary announcements only for general category or when no category filter
    let anniversaryAnnouncements = [];
    if (!category || category === 'general') {
      anniversaryAnnouncements = await anniversaryAnnouncementService.getTodayAnniversaryAnnouncements(user?.team);
      console.log('Adding anniversary announcements:', anniversaryAnnouncements.length);
    }
    
    // Combine regular announcements with anniversary announcements
    const allAnnouncements = [...anniversaryAnnouncements, ...announcements];
    
    // Apply sorting to combined announcements if sorting by date
    if (sortBy === 'date') {
      allAnnouncements.sort((a, b) => {
        const aDateTime = new Date(`${a.date.toISOString ? a.date.toISOString().split('T')[0] : a.date.split('T')[0]}T${a.time}`);
        const bDateTime = new Date(`${b.date.toISOString ? b.date.toISOString().split('T')[0] : b.date.split('T')[0]}T${b.time}`);
        
        if (sortOrder === 'desc') {
          return bDateTime.getTime() - aDateTime.getTime();
        } else {
          return aDateTime.getTime() - bDateTime.getTime();
        }
      });
    }
    
    const total = await Announcement.countDocuments(query);
    const totalWithAnniversaries = total + anniversaryAnnouncements.length;
    
    console.log('Found announcements:', announcements.length);
    console.log('Anniversary announcements:', anniversaryAnnouncements.length);
    console.log('Total count:', totalWithAnniversaries);

    return {
      announcements: allAnnouncements,
      total: totalWithAnniversaries,
      page,
      totalPages: Math.ceil(totalWithAnniversaries / limit)
    };
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch announcements');
  }
};

const getAnnouncementById = async (id) => {
  try {
    const announcement = await Announcement.findOne({
      _id: id,
      isDeleted: false
    }).populate([
      { path: 'createdBy', select: 'firstName lastName employeeId' },
      { path: 'departmentId', select: 'name' }
    ]);

    if (!announcement) {
      throw new ApiError(404, 'Announcement not found');
    }

    return announcement;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, 'Failed to fetch announcement');
  }
};

const updateAnnouncement = async (id, updateData, userId) => {
  try {
    const announcement = await Announcement.findOne({
      _id: id,
      isDeleted: false
    });

    if (!announcement) {
      throw new ApiError(404, 'Announcement not found');
    }

    // Get user information to check role
    const User = require('../models/userModel');
    const user = await User.findById(userId).select('role');

    // Check if user is the creator or has admin privileges
    const isCreator = announcement.createdBy.toString() === userId.toString();
    const isAdminUser = user?.role === 'hr' || user?.role === 'admin' || user?.role === 'subadmin';
    
    if (!isCreator && !isAdminUser) {
      throw new ApiError(403, 'Not authorized to update this announcement');
    }

    Object.assign(announcement, updateData);
    await announcement.save();

    return await announcement.populate([
      { path: 'createdBy', select: 'firstName lastName employeeId' },
      { path: 'departmentId', select: 'name' }
    ]);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, 'Failed to update announcement');
  }
};

const deleteAnnouncement = async (id, userId) => {
  try {
    const announcement = await Announcement.findOne({
      _id: id,
      isDeleted: false
    });

    if (!announcement) {
      throw new ApiError(404, 'Announcement not found');
    }

    // Get user information to check role
    const User = require('../models/userModel');
    const user = await User.findById(userId).select('role');

    // Check if user is the creator or has admin privileges
    const isCreator = announcement.createdBy.toString() === userId.toString();
    const isAdminUser = user?.role === 'hr' || user?.role === 'admin' || user?.role === 'subadmin';
    
    if (!isCreator && !isAdminUser) {
      throw new ApiError(403, 'Not authorized to delete this announcement');
    }

    announcement.isDeleted = true;
    await announcement.save();

    return { message: 'Announcement deleted successfully' };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, 'Failed to delete announcement');
  }
};

const getAnnouncementsByUser = async (userId, filters = {}) => {
  try {
    const {
      category = 'general',
      page = 1,
      limit = 10
    } = filters;

    // Get user information to check role
    const User = require('../models/userModel');
    const user = await User.findById(userId).select('role department');
    
    const query = {
      isDeleted: false
    };

    // If user is HR, Admin, or Subadmin, show all announcements
    if (user?.role === 'hr' || user?.role === 'admin' || user?.role === 'subadmin') {
      // Apply category filter for admin users
      if (category === 'general') {
        query.category = 'general';
      } else if (category === 'department') {
        query.category = 'department';
      }
      // If no category specified, show all announcements (no additional filter)
    } else if (user?.role === 'teamlead') {
      // TeamLead users can see all announcements (for main view)
      // Table view filtering will be handled in frontend
      if (category === 'general') {
        query.category = 'general';
      } else if (category === 'department') {
        query.category = 'department';
      }
      // If no category specified, show all announcements (no additional filter)
    } else {
      // Regular users - show only relevant announcements
      const userDepartments = user?.department ? [user.department] : [];
      
      // Apply category filter
      if (category === 'general') {
        query.category = 'general';
      } else if (category === 'department') {
        query.category = 'department'
        query.$or = [
          { departmentId: { $in: userDepartments } },
          { createdBy: userId }
        ]
      } else {
        // If no specific category, show all relevant announcements
        query.$or = [
          { category: 'general' },
          { 
            category: 'department',
            departmentId: { $in: userDepartments }
          }
        ];
      }
    }

    const skip = (page - 1) * limit;
    const sort = { createdAt: -1 };

    const announcements = await Announcement.find(query)
      .populate([
        { path: 'createdBy', select: 'firstName lastName employeeId' },
        { path: 'departmentId', select: 'name' }
      ])
      .sort(sort)
      .skip(skip)
      .limit(limit);

    // Get auto-generated anniversary announcements for user view (only for general category)
    let anniversaryAnnouncements = [];
    if (category === 'general') {
      anniversaryAnnouncements = await anniversaryAnnouncementService.getTodayAnniversaryAnnouncements(user?.team);
      console.log('Adding anniversary announcements for user view:', anniversaryAnnouncements.length);
    }
    
    // Combine regular announcements with anniversary announcements
    const allAnnouncements = [...anniversaryAnnouncements, ...announcements];
    
    const total = await Announcement.countDocuments(query);
    const totalWithAnniversaries = total + anniversaryAnnouncements.length;

    return {
      announcements: allAnnouncements,
      total: totalWithAnniversaries,
      page,
      totalPages: Math.ceil(totalWithAnniversaries / limit)
    };
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch user announcements');
  }
};


module.exports = {
  createAnnouncement,
  getAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementsByUser
};
