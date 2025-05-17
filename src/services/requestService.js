const Request = require('../models/requestModel');
const ApiError = require('../utility/ApiError');
const { default: httpStatus } = require('http-status');

// Create a new request
const createRequest = async (requestData) => {
    const newRequest = new Request({
        userId: requestData.userId,
        requestType: requestData.requestType,
        requestDescription: requestData.requestDescription,
        backDatedCheckIn: requestData.backDatedCheckIn // Use the entire backDatedCheckIn object
    });

    return await newRequest.save();
};


// Get all non-deleted requests
const getAllRequests = async () => {
    return await Request.find().sort({ createdAt: -1 });
};

// Get a request by ID
const getRequestById = async ({ id }) => {
    const request = await Request.findById(id);
    if (!request || request.isDeleted) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Request not found');
    }
    return request;
};

// Get requests by user
const getRequestsByUser = async ({ userId }) => {
    const reqs = await Request.aggregate([
        {
            $match: {
                userId: userId // Assuming userId is the field to match
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        }
    ]);
    // console.log("reqs",reqs);
    return reqs;
};

// Update request
const updateRequest = async (updateData) => {
    const request = await Request.findOne({
        _id: updateData.id,
        isDeleted: false,
    });

    if (!request) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Request not found');
    }

    // Update basic fields
    if (updateData.requestType) {
        request.requestType = updateData.requestType;
    }
    if (updateData.requestDescription) {
        request.requestDescription = updateData.requestDescription;
    }
    if (updateData.status) {
        request.status = updateData.status;
    }
    if (updateData.reviewedBy) {
        request.reviewedBy = updateData.reviewedBy;
    }
    if (updateData.reviewedAt) {
        request.reviewedAt = updateData.reviewedAt;
    }
    if (updateData.isDeleted !== undefined) {
        request.isDeleted = updateData.isDeleted;
    }

    // Update backDatedCheckIn if provided and requestType is backDatedCheckIn
    if (updateData.backDatedCheckIn && request.requestType === 'backDatedCheckIn') {
        request.backDatedCheckIn = { ...request.backDatedCheckIn, ...updateData.backDatedCheckIn };
    } else if (updateData.backDatedCheckIn) {
        // If backDatedCheckIn is provided but requestType is not, or is different, update it
        request.backDatedCheckIn = updateData.backDatedCheckIn;
    }

    return await request.save();
};

/**
 * Soft delete a request
 */
const deleteRequest = async ({ id }) => {
    const request = await Request.findById(id);
    if (!request || request.isDeleted) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Request not found');
    }

    request.isDeleted = true;
    request.status = "rejected";
    return await request.save();
};

module.exports = {
    createRequest,
    getAllRequests,
    getRequestById,
    getRequestsByUser,
    updateRequest,
    deleteRequest,
};