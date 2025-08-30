const Attendance = require('../models/attendanceModel');
const User = require('../models/userModel');
const moment = require('moment-timezone');
const { transformDocumentPaths } = require('../utility/common');

const regularizationService = {
  // Get regularization limits and usage for a user
  async getRegularizationLimits(userId) {
    try {
      const now = moment.tz('Asia/Kolkata');
      const startOfMonth = now.clone().startOf('month');
      const endOfMonth = now.clone().endOf('month');

      // Get all standard regularization requests for current month
      const monthlyRegularizations = await Attendance.find({
        user: userId,
        'regularization.type': 'standard',
        'regularization.status': { $in: ['tl-pending', 'hr-pending', 'approved'] },
        date: {
          $gte: startOfMonth.toDate(),
          $lte: endOfMonth.toDate()
        }
      });

      const used = monthlyRegularizations.length;
      const total = 4; // Standard regularization limit per month
      const available = Math.max(0, total - used);

      return {
        total,
        used,
        available,
        monthlyRegularizations
      };
    } catch (error) {
      throw error;
    }
  },

  // Create regularization request
  async createRegularization(userId, requestData) {
    try {
      const { date, correctedCheckIn, correctedCheckOut, reason, type, evidence } = requestData;

      // Validate date is not in the future
      const requestDate = moment.tz(date, 'Asia/Kolkata').startOf('day');
      const today = moment.tz('Asia/Kolkata').startOf('day');
      
      if (requestDate.isAfter(today)) {
        throw new Error('Cannot create regularization for future dates');
      }

      // Check monthly limit for standard regularization
      if (type === 'standard') {
        const limits = await this.getRegularizationLimits(userId);
        if (limits.available <= 0) {
          throw new Error('Monthly limit for standard regularization has been reached (4 per month)');
        }
      }

      // Check if attendance already exists for this date
      const existingAttendance = await Attendance.findOne({
        user: userId,
        date: requestDate.toDate()
      });

      // Check if regularization already exists (but allow if it's revoked)
      if (existingAttendance && existingAttendance.regularization && existingAttendance.regularization.status !== 'revoked') {
        throw new Error('Regularization request already exists for this date');
      }

      // Check if user has full day leave applied
      if (existingAttendance && existingAttendance.status === 'leave_applied_full') {
        throw new Error('Cannot create regularization request when full day leave is already applied');
      }

      // Check if user already has present status (no need for regularization)
      if (existingAttendance && existingAttendance.status === 'present') {
        throw new Error('Cannot create regularization request when attendance is already marked as present');
      }

      // Create or update attendance record with regularization
      const regularizationData = {
        type,
        reason,
        requestedCheckInTime: moment.tz(`${date} ${correctedCheckIn}`, 'Asia/Kolkata').toDate(),
        requestedCheckOutTime: moment.tz(`${date} ${correctedCheckOut}`, 'Asia/Kolkata').toDate(),
        evidence: type === 'emergency' ? { url: evidence } : undefined,
        status: 'tl-pending',
        appliedAt: new Date(),
        appliedBy: userId
      };

      let attendance = await Attendance.findOne({
        user: userId,
        date: requestDate.toDate()
      });

      if (attendance) {
        // Update existing attendance with regularization
        attendance.regularization = regularizationData;
        await attendance.save();
      } else {
        // Create new attendance record with regularization
        attendance = new Attendance({
          user: userId,
          date: requestDate.toDate(),
          regularization: regularizationData
        });
        await attendance.save();
      }

      // Email notification will be handled in the controller

      // Transform evidence URL to include base URL for the response
      if (attendance.regularization && attendance.regularization.evidence && attendance.regularization.evidence.url) {
        const baseUrl = process.env.IMAGE_BASE_URL;
        if (baseUrl && !attendance.regularization.evidence.url.startsWith('http')) {
          attendance.regularization.evidence.url = `${baseUrl}/${attendance.regularization.evidence.url}`;
        }
      }

      return {
        status: 'success',
        message: 'Regularization request created successfully',
        data: attendance
      };
    } catch (error) {
      throw error;
    }
  },

  // Get all regularization requests
  async getRegularizations(userId, userRole, filters = {}) {
    try {
      const { startDate, endDate, status, type, page = 1, limit = 10, department, logFilter } = filters;
      const query = { 'regularization.status': { $exists: true } };

      // Add date filters
      if (startDate && endDate) {
        query.date = {
          $gte: moment.tz(startDate, 'Asia/Kolkata').startOf('day').toDate(),
          $lte: moment.tz(endDate, 'Asia/Kolkata').endOf('day').toDate()
        };
      }

      // Add status filter
      if (status) {
        query['regularization.status'] = status;
      }

      // Add type filter
      if (type) {
        query['regularization.type'] = type;
      }

      // Add department filter
      if (department) {
        const departmentUsers = await User.find({ department }).select('_id');
        query.user = { $in: departmentUsers.map(u => u._id) };
      }

      // Role-based filtering with log filter
      if (logFilter === 'my-log') {
        // Show only user's own requests
        query.user = userId;
      } else if (logFilter === 'all-log') {
        // Show all requests based on role
        if (userRole === 'teamlead') {
          // Team leads can see their team members' requests
          const teamMembers = await this.getTeamMembers(userId);
          query.user = { $in: teamMembers };
        } else if (userRole === 'employee') {
          // Employees can only see their own requests (same as my-log)
          query.user = userId;
        }
        // For admin, subadmin, hr - no additional filtering needed (can see all)
      } else {
        // Default behavior (backward compatibility)
        if (userRole === 'teamlead') {
          // Team leads can see their team members' requests
          const teamMembers = await this.getTeamMembers(userId);
          query.user = { $in: teamMembers };
        } else if (userRole === 'employee') {
          // Employees can only see their own requests
          query.user = userId;
        }
      }

      // Calculate pagination
      const pageInt = parseInt(page);
      const limitInt = parseInt(limit);
      const skip = (pageInt - 1) * limitInt;

      // Get total count for pagination
      const total = await Attendance.countDocuments(query);
      
      // Get paginated data
      const attendances = await Attendance.find(query)
        .populate({
          path: 'user',
          select: 'firstName lastName employeeId email role',
          populate: {
            path: 'department',
            select: 'name'
          }
        })
        .populate('regularization.tl.reviewer', 'firstName lastName')
        .populate('regularization.hr.reviewer', 'firstName lastName')
        .sort({ 'regularization.appliedAt': -1 })
        .skip(skip)
        .limit(limitInt)
        .lean();

      // Transform evidence URLs to include base URL
      const transformedAttendances = attendances.map(attendance => {
        if (attendance.regularization && attendance.regularization.evidence && attendance.regularization.evidence.url) {
          const baseUrl = process.env.IMAGE_BASE_URL;
          if (baseUrl && !attendance.regularization.evidence.url.startsWith('http')) {
            attendance.regularization.evidence.url = `${baseUrl}/${attendance.regularization.evidence.url}`;
          }
        }
        return attendance;
      });

      return {
        status: 'success',
        data: transformedAttendances,
        totalPages: Math.ceil(total / limitInt),
        currentPage: pageInt,
        totalRecords: total
      };
    } catch (error) {
      throw error;
    }
  },

  // Get regularization by ID
  async getRegularizationById(regularizationId, userId, userRole) {
    try {
      const attendance = await Attendance.findOne({
        _id: regularizationId,
        'regularization.status': { $exists: true }
      })
        .populate('user', 'firstName lastName employeeId email')
        .populate('regularization.tl.reviewer', 'firstName lastName')
        .populate('regularization.hr.reviewer', 'firstName lastName')
        .lean();

      if (!attendance) {
        throw new Error('Regularization request not found');
      }

      // Check access permissions
      if (!this.canReview(attendance, userId, userRole)) {
        throw new Error('Access denied');
      }

      // Transform evidence URL to include base URL
      if (attendance.regularization && attendance.regularization.evidence && attendance.regularization.evidence.url) {
        const baseUrl = process.env.IMAGE_BASE_URL;
        if (baseUrl && !attendance.regularization.evidence.url.startsWith('http')) {
          attendance.regularization.evidence.url = `${baseUrl}/${attendance.regularization.evidence.url}`;
        }
      }

      return {
        status: 'success',
        data: attendance
      };
    } catch (error) {
      throw error;
    }
  },

  // Approve regularization request
  async approveRegularization(regularizationId, reviewerId, userRole, comment = '') {
    try {
      const attendance = await Attendance.findOne({
        _id: regularizationId,
        'regularization.status': { $exists: true }
      }).populate('user', 'firstName lastName email');

      if (!attendance) {
        throw new Error('Regularization request not found');
      }

      if (!this.canReview(attendance, reviewerId, userRole)) {
        throw new Error('Access denied');
      }

      const regularization = attendance.regularization;
      let newStatus = regularization.status;

      if (userRole === 'teamlead' && regularization.status === 'tl-pending') {
        // Team Lead approval
        regularization.tl = {
          reviewer: reviewerId,
          decision: 'approved',
          comment,
          decidedAt: new Date()
        };
        newStatus = 'hr-pending';
      } else if (['hr', 'subadmin', 'admin'].includes(userRole) && regularization.status === 'hr-pending') {
        // HR approval
        regularization.hr = {
          reviewer: reviewerId,
          decision: 'approved',
          comment,
          decidedAt: new Date()
        };
        newStatus = 'approved';

        // Update attendance record with corrected times
        await this.updateAttendanceRecord(attendance);
      } else {
        throw new Error('Invalid action for current status');
      }

      regularization.status = newStatus;
      await attendance.save();

      // Email notification will be handled in the controller

      return {
        status: 'success',
        message: 'Regularization request approved successfully',
        data: attendance
      };
    } catch (error) {
      throw error;
    }
  },

  // Reject regularization request
  async rejectRegularization(regularizationId, reviewerId, userRole, reason) {
    try {
      const attendance = await Attendance.findOne({
        _id: regularizationId,
        'regularization.status': { $exists: true }
      }).populate('user', 'firstName lastName email');

      if (!attendance) {
        throw new Error('Regularization request not found');
      }

      if (!this.canReview(attendance, reviewerId, userRole)) {
        throw new Error('Access denied');
      }

      const regularization = attendance.regularization;
      let newStatus = regularization.status;

      if (userRole === 'teamlead' && regularization.status === 'tl-pending') {
        // Team Lead rejection
        regularization.tl = {
          reviewer: reviewerId,
          decision: 'rejected',
          comment: reason,
          decidedAt: new Date()
        };
        newStatus = 'tl-rejected';
      } else if (['hr', 'subadmin', 'admin'].includes(userRole) && regularization.status === 'hr-pending') {
        // HR rejection
        regularization.hr = {
          reviewer: reviewerId,
          decision: 'rejected',
          comment: reason,
          decidedAt: new Date()
        };
        newStatus = 'hr-rejected';
      } else {
        throw new Error('Invalid action for current status');
      }

      regularization.status = newStatus;
      await attendance.save();

      // Email notification will be handled in the controller

      return {
        status: 'success',
        message: 'Regularization request rejected successfully',
        data: attendance
      };
    } catch (error) {
      throw error;
    }
  },

  // Revoke regularization request
  async deleteRegularization(regularizationId, userId) {
    try {
      const attendance = await Attendance.findOne({
        _id: regularizationId,
        'regularization.status': { $exists: true }
      });

      if (!attendance) {
        throw new Error('Regularization request not found');
      }

      // Only allow revocation if user is the applicant and status is pending
      if (attendance.regularization.appliedBy.toString() !== userId.toString()) {
        throw new Error('Access denied');
      }

      if (!['tl-pending', 'hr-pending'].includes(attendance.regularization.status)) {
        throw new Error('Cannot revoke non-pending requests');
      }

      // Change status to revoked instead of removing data
      attendance.regularization.status = 'revoked';
      await attendance.save();

      return {
        status: 'success',
        message: 'Regularization request revoked successfully'
      };
    } catch (error) {
      throw error;
    }
  },

  // Get pending approvals for reviewer
  async getPendingApprovals(userId, userRole) {
    try {
      let query = { 'regularization.status': { $exists: true } };

      if (userRole === 'teamlead') {
        query['regularization.status'] = 'tl-pending';
        const teamMembers = await this.getTeamMembers(userId);
        query.user = { $in: teamMembers };
      } else if (['hr', 'subadmin', 'admin'].includes(userRole)) {
        query['regularization.status'] = 'hr-pending';
      } else {
        return { status: 'success', data: [] };
      }

      const attendances = await Attendance.find(query)
        .populate('user', 'firstName lastName employeeId email')
        .sort({ 'regularization.appliedAt': -1 })
        .lean();

      // Transform evidence URLs to include base URL
      const transformedAttendances = attendances.map(attendance => {
        if (attendance.regularization && attendance.regularization.evidence && attendance.regularization.evidence.url) {
          const baseUrl = process.env.IMAGE_BASE_URL;
          if (baseUrl && !attendance.regularization.evidence.url.startsWith('http')) {
            attendance.regularization.evidence.url = `${baseUrl}/${attendance.regularization.evidence.url}`;
          }
        }
        return attendance;
      });

      return {
        status: 'success',
        data: transformedAttendances
      };
    } catch (error) {
      throw error;
    }
  },

  // Helper methods
  async getTeamMembers(teamLeadId) {
    try {
      const teamMembers = await User.find({
        $or: [
          { _id: teamLeadId },
          { teamLeadId: teamLeadId }
        ]
      }).select('_id');
      return teamMembers.map(member => member._id);
    } catch (error) {
      throw error;
    }
  },

  canReview(attendance, userId, userRole) {
    if (userRole === 'admin' || userRole === 'subadmin') {
      return true;
    }

    if (userRole === 'hr') {
      return true;
    }

    if (userRole === 'teamlead') {
      // Team lead can review requests from their team members
      // Check if the attendance user has this team lead as their teamLead
      return true; // We'll handle team membership in the query itself
    }

    return false;
  },

  async updateAttendanceRecord(attendance) {
    try {
      const regularization = attendance.regularization;
      
      // Update check-in and check-out times
      attendance.checkInTime = regularization.requestedCheckInTime;
      attendance.checkOutTime = regularization.requestedCheckOutTime;
      
      // When regularization is approved, set status to 'present'
      // The regularization was requested to correct attendance issues
      attendance.status = 'present';
      await attendance.save();
      
      return attendance;
    } catch (error) {
      throw error;
    }
  },


};

module.exports = regularizationService;
