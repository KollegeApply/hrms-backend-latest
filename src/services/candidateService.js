const Candidate = require('../models/candidateModel');
const UserDetails = require('../models/userDetailsModel');
const { generateCIFToken, cleanEmptyFields } = require('../utility/common');
const _ = require('lodash');
const jwt = require('jsonwebtoken');

class CandidateService {
  async createCandidate(data,userId){
    try {
      const candidate = await Candidate.create({
        ...data, 
        pointOfContact:userId,
      });
      return {
        candidate,
          token: generateCIFToken(data.personalEmail),
        };
    } catch (error) {
      throw error;
    }
  }

  async getCandidates({ page = 1, limit = 10, status, search }) {
    const query = { isDeleted: false };
  
    if (status) query.status = status;
  
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { personalEmail: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }
  
    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;
  
    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('pointOfContact', 'firstName lastName email')
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


  async  saveDraft(email, data) {
    const candidate = await Candidate.findOne({ personalEmail: email });
    if (!candidate) {
      throw new Error('Candidate not found');
    }

    const cleanedData = cleanEmptyFields(data); 

  
    // --- CRITICAL FIX: Use lodash.merge for a deep merge to update details instead of overwriting ---
    if (candidate.userDetails) {
      // If details exist, fetch the existing document
      const existingDetails = await UserDetails.findById(candidate.userDetails);
      if (!existingDetails) {
          // Handle rare case where ID exists but document doesn't
          const newUserDetails = await UserDetails.create(cleanedData);
          candidate.userDetails = newUserDetails._id;
      } else {
          // Deep merge the new data into the existing data. This is the fix.
          const mergedData = _.merge(existingDetails.toObject(), cleanedData);
          console.log(mergedData);
          await UserDetails.findByIdAndUpdate(candidate.userDetails, mergedData);
      }
    } else {
      // If no details exist, create a new document
      const userDetails = await UserDetails.create(cleanedData);
      candidate.userDetails = userDetails._id;
    }
  
    // Update the candidate's overall status if needed
    if (candidate.status === 'pending' || candidate.status === 'draft') {
        candidate.status = 'draft';
    }
    if(candidate.status === 'resended' || candidate.status === 'redraft'){
      candidate.status = 'redraft';
    }
    
    await candidate.save();
  
    // Return the fully populated candidate to the frontend
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

  // Update userDetails document
  await UserDetails.findByIdAndUpdate(candidate.userDetails, { ...data }, { new: true });

  // Update candidate status
  await Candidate.findByIdAndUpdate(candidate._id, { status: newStatus });

  // Return updated candidate with populated userDetails
  return await Candidate.findById(candidate._id).populate('pointOfContact', 'firstName lastName email');;
}

  
  async editCandidate(id, data) {
    const candidate = await Candidate.findById(id);
    if (!candidate) throw new Error('Candidate not found');
    if (!candidate.userDetails) throw new Error('UserDetails not found');
    if(data?.isApproved){
      status = "approved";
    }else{
      status = "underReview";
    }
    await UserDetails.findByIdAndUpdate(candidate.userDetails, { ...data, status: status }, { new: true });
    return await Candidate.findOne({ personalEmail: email }).populate('userDetails');
  }

  async  reviewUpdateCandidate(candidateId, updateData){
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw new Error('Candidate not found');
  }

  // Find or create the userDetails document
  let userDetails = await UserDetails.findById(candidate.userDetails);
  if (!userDetails) {
    userDetails = new UserDetails();
  }

  // Update all fields from the form
  Object.assign(userDetails, updateData);
  await userDetails.save();

  // Update the candidate status
  candidate.status = 'underReview';
  candidate.userDetails = userDetails._id; // Ensure the reference is set
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

 async resendCifInvite(candidateId)  {
  const candidate = await Candidate.findById(candidateId).populate('userDetails');
  if (!candidate) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Candidate not found');
  }

  if (candidate.userDetails) {
  candidate.userDetails.certification = false;
  await candidate.userDetails.save();
}

  candidate.status = 'resended';
  
  // Generate a new token for the candidate
  const token = jwt.sign(
    { email: candidate.personalEmail, exp: Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60) }, 
    process.env.CIF_TOKEN_SECRET 
  );

  await candidate.save();

  const updatedCandidate = await Candidate.findById(candidateId).populate('userDetails pointOfContact');
  
  return { candidate:updatedCandidate, token };
};
}

module.exports = new CandidateService();
