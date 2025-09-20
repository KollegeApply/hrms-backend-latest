const Candidate = require('../models/candidateModel');
const UserDetails = require('../models/userDetailsModel');
const { generateCIFToken, cleanEmptyFields } = require('../utility/common');
const _ = require('lodash');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const aiService = require('./aiService');
const logger = require('../config/logger');


const cleanDataForUpdate = (data) => {
  const cleanData = JSON.parse(JSON.stringify(data));
  delete cleanData._id;
  
  const nestedFields = ['personalInfo', 'addressDetails', 'educationDetails', 'medicalInfo', 'backgroundInfo', 'bankDetails', 'documents'];
  nestedFields.forEach(field => {
    if (cleanData[field] && cleanData[field]._id) {
      delete cleanData[field]._id;
    }
  });
  
  return cleanData;
};

class CandidateService {
  async createCandidate(data, userId) {
    try {
      const candidate = await Candidate.create({
        ...data,
        pointOfContact: userId,
      });
      return {
        candidate,
        token: generateCIFToken(data.personalEmail),
      };
    } catch (error) {
      throw error;
    }
  }

  async getCandidates({ page = 1, limit = 10, status, search }, team) {
    const query = { isDeleted: false };

    if (status) {
      query.status = status;
    }

    if (search) {
      const searchTerm = search.trim();
      const regex = new RegExp(searchTerm, 'i');
      
      const searchFilters = [
        { firstName: regex },
        { lastName: regex },
        { personalEmail: regex },
        { phoneNumber: regex }
      ];
      
      // Handle full name search (firstName + lastName combinations)
      const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
      if (searchWords.length >= 2) {
        // Search for "firstName lastName" combination
        searchFilters.push({
          $and: [
            { firstName: new RegExp(searchWords[0], 'i') },
            { lastName: new RegExp(searchWords[1], 'i') }
          ]
        });
        
        // Search for "lastName firstName" combination (reverse order)
        searchFilters.push({
          $and: [
            { firstName: new RegExp(searchWords[1], 'i') },
            { lastName: new RegExp(searchWords[0], 'i') }
          ]
        });
      }
      
      query.$or = searchFilters;
    }

    const teamUsers = await User.find({ team }, '_id');
    const teamUserIds = teamUsers.map(user => user._id);

    query.pointOfContact = { $in: teamUserIds };

    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;

    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('pointOfContact', 'firstName lastName email team')
        .populate('department', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitInt),
      Candidate.countDocuments(query),
    ]);

    return {
      candidates,
      total,
      page: pageInt,
      pageSize: limitInt,
      totalPages: Math.ceil(total / limitInt),
    };
  }



  async saveDraft(email, data) {
    const user = await User.findOne({ email: email, isDeleted: false });
    let candidate;

    if (user) {
      candidate = await User
        .findOne({ email: email, isDeleted: false });
    } else {
      candidate = await Candidate.findOne({ personalEmail: email, isDeleted: false, status: { $ne: 'backout' } });
    }
    if (!candidate) {
      throw new Error('Candidate not found');
    }

    const cleanedData = cleanEmptyFields(data);

    if (candidate.userDetails) {
      const existingDetails = await UserDetails.findById(candidate.userDetails);
      if (!existingDetails) {
        const newUserDetails = await UserDetails.create(cleanedData);
        candidate.userDetails = newUserDetails._id;
      } else {
        const mergedData = _.merge(existingDetails.toObject(), cleanedData);
        const cleanMergedData = cleanDataForUpdate(mergedData);
        
        await UserDetails.findByIdAndUpdate(candidate.userDetails, cleanMergedData);
      }
    } else {
      const userDetails = await UserDetails.create(cleanedData);
      candidate.userDetails = userDetails._id;
    }
    const isPendingOrDraft = (value) => value === 'pending' || value === 'draft';

    if (
      isPendingOrDraft(candidate?.status) ||
      isPendingOrDraft(candidate?.formStatus)
    ) {
      if (isPendingOrDraft(candidate?.status)) {
        candidate.status = 'draft';
      }
      if (isPendingOrDraft(candidate?.formStatus)) {
        candidate.formStatus = 'draft';
      }
    }
    if (candidate.status === 'resended' || candidate.status === 'redraft') {
      candidate.status = 'redraft';
    }

    await candidate.save();

    return Candidate.findOne({ personalEmail: email, isDeleted: false }).populate('userDetails');
  }


async finalSubmit(email, data) {
  const user = await User.findOne({ email: email, isDeleted: false });
  let candidate;
  let existingUser = false;

  if (user) {
    candidate = user;
    existingUser = true;
  } else {
    candidate = await Candidate.findOne({ personalEmail: email, isDeleted: false, status: { $ne: 'backout' } });
  }

  if (!candidate) throw new Error('Candidate not found');
  if (!candidate.userDetails) throw new Error('UserDetails not found');

  if (candidate.status === "backout") {
    throw new Error('Candidate has already backed out.');
  }

  let newStatus;
  if (
    candidate.status === "pending" ||
    candidate.status === "draft" ||
    candidate.formStatus === "pending" ||
    candidate.formStatus === "draft" ||
    candidate.formStatus === "reminder_sent"
  ) {
    newStatus = "submitted";
  } else {
    newStatus = "resubmitted";
  }


  const cleanData = cleanDataForUpdate(data);

  const updatedUserDetails = await UserDetails.findByIdAndUpdate(
    candidate.userDetails,
    cleanData,
    { new: true }
  );

  if (existingUser) {
    await User.findByIdAndUpdate(candidate._id, {
      formStatus: newStatus,
      dateOfBirth: updatedUserDetails?.personalInfo?.dateOfBirth || null
    });
  } else {
    await Candidate.findByIdAndUpdate(candidate._id, { status: newStatus });
  }

  return await Candidate.findById(candidate._id)
    .populate('pointOfContact', 'firstName lastName email team');
}



  async editCandidate(id, data) {
    const candidate = await Candidate.findById(id);
    if (!candidate) throw new Error('Candidate not found');
    if (!candidate.userDetails) throw new Error('UserDetails not found');
    if (data?.isApproved) {
      status = "approved";
    } else {
      status = "underReview";
    }
    
    const cleanData = cleanDataForUpdate(data);
    
    await UserDetails.findByIdAndUpdate(candidate.userDetails, { ...cleanData, status: status }, { new: true });
    return await Candidate.findOne({ personalEmail: email, isDeleted: false }).populate('userDetails');
  }

  async reviewUpdateCandidate(candidateId, updateData) {
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      throw new Error('Candidate not found');
    }

    let userDetails = await UserDetails.findById(candidate.userDetails);
    if (!userDetails) {
      userDetails = new UserDetails();
    }

    Object.assign(userDetails, updateData);
    await userDetails.save();

    candidate.status = 'underReview';
    candidate.userDetails = userDetails._id;
    await candidate.save();

    return candidate;
  };

  async approveCandidate(candidateId) {
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Candidate not found');
    }

    candidate.status = 'approved';
    await candidate.save();

    return candidate;
  };

  async resendCifInvite(candidateId) {
    const candidate = await Candidate.findById(candidateId).populate('userDetails');
    if (!candidate) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Candidate not found');
    }

    if (candidate.userDetails) {
      candidate.userDetails.certification = false;
      await candidate.userDetails.save();
    }

    candidate.status = 'resended';

    const token = jwt.sign(
      { email: candidate.personalEmail, exp: Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60) },
      process.env.CIF_TOKEN_SECRET
    );

    await candidate.save();

    const updatedCandidate = await Candidate.findById(candidateId).populate('userDetails pointOfContact');

    return { candidate: updatedCandidate, token };
  };

  async requestDevice(candidateId, requestData) {
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Candidate not found');
    }

    const requests = { byod: false, byov: false };

    if (requestData.byod && !candidate.requestsSent.byod) {
      candidate.requestsSent.byod = true;
      requests.byod = true;
    }
    if (requestData.byov && !candidate.requestsSent.byov) {
      candidate.requestsSent.byov = true;
      requests.byov = true;
    }

    await candidate.save();
    return { candidate, requests };
  };
}

module.exports = new CandidateService();
