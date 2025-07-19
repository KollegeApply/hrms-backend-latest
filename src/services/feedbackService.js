const Feedback = require("../models/feedbackModel");


class FeedbacksService {
    async createFeedback(data, user) {
        if (!data || typeof data !== 'object') {
            throw new Error("Invalid or missing data payload");
        }

        const ratingValues = Object.values(data.rating || {}).filter(val => typeof val === 'number');
        const overallRating = ratingValues.reduce((sum, val) => sum + val, 0) / ratingValues.length;

        const feedback = new Feedback({
            ...data,
            givenBy: user.id,
            rating: {
                ...data.rating,
                overall: parseFloat(overallRating.toFixed(1)),
            },
        });

        await feedback.save();
        return feedback;
    }

    getAllFeedbacks = async (userId, userRole) => {
        const isAdmin = ['admin', 'subadmin', 'hr'].includes(userRole);

        const filter = isAdmin
            ? {}
            : {
                $or: [{ givenBy: userId }, { givenTo: userId }],
            };

        const feedbacks = await Feedback.find(filter)
            .populate('givenBy', 'firstName lastName email role employeeId')
            .populate('givenTo', 'firstName lastName email role employeeId')
            .sort({ createdAt: -1 });

        return feedbacks;
    };


    async getFeedbackById(feedbackId, userId, userRole) {
        const feedback = await Feedback.findById(feedbackId)
            .populate('givenBy', 'firstName lastName email role employeeId')
            .populate('givenTo', 'firstName lastName email role employeeId');

        if (!feedback) return null;

        const isAdmin = ['admin', 'subadmin', 'hr'].includes(userRole);
        const isInvolved =
            feedback.givenBy._id.toString() === userId.toString() ||
            feedback.givenTo._id.toString() === userId.toString();

        if (!isAdmin && !isInvolved) {
            return null;
        }

        return feedback;
    };

    async raiseConcern(feedbackId, userId, role, reason) {
        if (!reason?.trim()) {
            return { success: false, message: "Reason is required." };
        }

        const feedback = await Feedback.findById(feedbackId);
        if (!feedback) return { success: false, message: "Feedback not found." };

        if (feedback.givenTo.toString() !== userId.toString()) {
            return {
                success: false,
                message: "You are not authorized to raise a concern on this feedback.",
            };
        }

        if (feedback.concernRaised) {
            return {
                success: false,
                message: "Concern already raised.",
            };
        }

        feedback.concernRaised = true;
        feedback.concernReason = reason;
        await feedback.save();

        return { success: true };
    };


    async requestEdit(feedbackId, userId) {
        const feedback = await Feedback.findById(feedbackId);

        if (!feedback) {
            throw new Error("Feedback not found.");
        }

        if (feedback.givenBy.toString() !== userId) {
            throw new Error("Unauthorized: You can only request edit for your own feedback.");
        }

        if (feedback.editRequest?.requested) {
            throw new Error("Edit request already submitted.");
        }

        feedback.editRequest = {
            requested: true,
            approved: false,
            rejected: false,
            completed: false,
        };

        await feedback.save();

        return feedback;
    };

    async updateEditRequestStatus(id, status) {
        if (!["approved", "rejected"].includes(status)) {
            throw new Error("Invalid status");
        }

        const update = {
            "editRequest.approved": status === "approved",
            "editRequest.rejected": status === "rejected",
        };

        const updatedFeedback = await Feedback.findByIdAndUpdate(id, { $set: update }, { new: true });

        if (!updatedFeedback) {
            throw new Error("Feedback not found");
        }

        return updatedFeedback;
    };


    async updateFeedback(id, data) {
          const ratingValues = Object.values(data.rating || {}).filter(val => typeof val === 'number');
        const overallRating = ratingValues.reduce((sum, val) => sum + val, 0) / ratingValues.length;

        const updatedFeedback = Feedback.findByIdAndUpdate(id, {
            feedback: data.feedback,
    rating: {
                ...data.rating,
                overall: parseFloat(overallRating.toFixed(1)),
            },
            "editRequest.completed": true,
        }, {
            new: true,
        });

        
        return updatedFeedback;
    };
}

module.exports = new FeedbacksService();
