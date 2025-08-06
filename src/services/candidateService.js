const Candidate = require('../models/candidateModel');
const UserDetails = require('../models/userDetailsModel');
const { generateCIFToken, cleanEmptyFields } = require('../utility/common');
const _ = require('lodash');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

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
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { personalEmail: { $regex: search, $options: 'i' } },
      { phoneNumber: { $regex: search, $options: 'i' } }
    ];
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
    const candidate = await Candidate.findOne({ personalEmail: email });
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
        await UserDetails.findByIdAndUpdate(candidate.userDetails, mergedData);
      }
    } else {
      const userDetails = await UserDetails.create(cleanedData);
      candidate.userDetails = userDetails._id;
    }

    if (candidate.status === 'pending' || candidate.status === 'draft') {
      candidate.status = 'draft';
    }
    if (candidate.status === 'resended' || candidate.status === 'redraft') {
      candidate.status = 'redraft';
    }

    await candidate.save();

    return Candidate.findOne({ personalEmail: email }).populate('userDetails');
  }


  async finalSubmit(email, data) {
    const candidate = await Candidate.findOne({ personalEmail: email });
    if (!candidate) throw new Error('Candidate not found');
    if (!candidate.userDetails) throw new Error('UserDetails not found');

    if (candidate.status === "backout") {
      throw new Error('Candidate has already backed out.');
    }

    let newStatus;
    if (candidate.status === "pending" || candidate.status === "draft") {
      newStatus = "submitted";
    } else {
      newStatus = "resubmitted";
    }

    await UserDetails.findByIdAndUpdate(candidate.userDetails, { ...data }, { new: true });

    await Candidate.findByIdAndUpdate(candidate._id, { status: newStatus });

    return await Candidate.findById(candidate._id).populate('pointOfContact', 'firstName lastName email team');;
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
    await UserDetails.findByIdAndUpdate(candidate.userDetails, { ...data, status: status }, { new: true });
    return await Candidate.findOne({ personalEmail: email }).populate('userDetails');
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
