const Feedback = require("../models/feedbackModel");
const User = require("../models/userModel");
const aiService = require("./aiService");
const logger = require("../config/logger");


class FeedbacksService {
    async createFeedback(data, user) {
        if (!data || typeof data !== 'object') {
            throw new Error("Invalid or missing data payload");
        }

        const ratingValues = Object.values(data.rating || {}).filter(val => typeof val === 'number');
        const overallRating = ratingValues.reduce((sum, val) => sum + val, 0) / ratingValues.length;

        // AI Analysis - extract AI fields if present from middleware
        const aiFields = {
            sentiment: data.sentiment || 'Neutral',
            sentimentScore: data.sentimentScore || 50,
            keywords: data.keywords || [],
            aiRecommendation: data.recommendation || ''
        };

        // If AI analysis wasn't done by middleware, do it now
        if (!data.sentiment && data.feedback) {
            try {
                logger.info('Performing AI analysis for feedback creation');
                const aiAnalysis = await aiService.analyzeFeedback(data.feedback);
                aiFields.sentiment = aiAnalysis.sentiment;
                aiFields.sentimentScore = aiAnalysis.sentimentScore;
                aiFields.keywords = aiAnalysis.keywords;
                aiFields.aiRecommendation = aiAnalysis.recommendation;
            } catch (error) {
                logger.error('AI analysis failed during feedback creation:', error);
                // Continue with default values
            }
        }

        const feedback = new Feedback({
            ...data,
            givenBy: user.id,
            rating: {
                ...data.rating,
                overall: parseFloat(overallRating.toFixed(1)),
            },
            // Add AI analysis fields
            ...aiFields
        });

        await feedback.save();
        
        logger.info('Feedback created with AI analysis', {
            feedbackId: feedback._id,
            sentiment: aiFields.sentiment,
            sentimentScore: aiFields.sentimentScore,
            keywordsCount: aiFields.keywords.length
        });

        return feedback;
    }

   getAllFeedbacks = async (userId, userRole, userTeam, filters = {}) => {
    const teamUsers = await User.find({ team: userTeam }, '_id');
    const teamUserIds = teamUsers.map(user => user._id);

    const isAdmin = ['admin', 'subadmin', 'hr'].includes(userRole);

    // Base filter for admin/HR users
    let baseFilter = isAdmin
        ? { givenBy: { $in: teamUserIds } }
        : {
            $or: [
                { givenBy: userId },          
                { givenTo: userId },   
                { givenBy: { $in: teamUserIds } }
            ]
        };

    // Build additional filters
    let additionalFilters = {};

    // Department filter
    if (filters.department) {
        const departmentUsers = await User.find({ department: filters.department }, '_id');
        const departmentUserIds = departmentUsers.map(user => user._id);
        additionalFilters.givenTo = { $in: departmentUserIds };
    }


    // Period range filter (feedback period)
    if (filters.periodFrom || filters.periodTo) {
        const periodFilter = {};
        if (filters.periodFrom) {
            periodFilter.from = { $gte: new Date(filters.periodFrom) };
        }
        if (filters.periodTo) {
            periodFilter.to = { $lte: new Date(filters.periodTo) };
        }
        additionalFilters = { ...additionalFilters, ...periodFilter };
    }

    // Combine base filter with additional filters
    let finalFilter = { ...baseFilter, ...additionalFilters };

    // Handle complex queries with $and if needed
    if (Object.keys(additionalFilters).length > 0) {
        finalFilter = {
            $and: [
                baseFilter,
                additionalFilters
            ]
        };
    }

    // Pagination
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 10;
    const skip = (page - 1) * limit;


    const feedbacks = await Feedback.find(finalFilter)
        .populate('givenBy', 'firstName lastName email role employeeId team department')
        .populate('givenTo', 'firstName lastName email role employeeId team department')
        .populate('givenTo.department', 'name')
        .populate('givenBy.department', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    // Get total count for pagination
    const totalCount = await Feedback.countDocuments(finalFilter);

    return {
        feedbacks,
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount,
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1
        }
    };
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

        return feedback;
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

    async getFeedbackTrends(feedbackId, userId, userRole) {
        // First get the current feedback to identify the employee
        const currentFeedback = await Feedback.findById(feedbackId)
            .populate('givenTo', 'firstName lastName employeeId');

        if (!currentFeedback) {
            throw new Error("Feedback not found");
        }

        const isAdmin = ['admin', 'subadmin', 'hr'].includes(userRole);
        const isInvolved =
            currentFeedback.givenBy.toString() === userId.toString() ||
            currentFeedback.givenTo._id.toString() === userId.toString();

        if (!isAdmin && !isInvolved) {
            throw new Error("Access denied");
        }

        const employeeId = currentFeedback.givenTo._id;

        // Get all feedbacks for this employee, sorted by period
        const historicalFeedbacks = await Feedback.find({
            givenTo: employeeId,
            _id: { $ne: feedbackId } // Exclude current feedback
        })
        .populate('givenBy', 'firstName lastName')
        .sort({ from: 1, createdAt: 1 }); // Sort by period start date

        // Process the data for trend analysis
        const trends = {
            employee: {
                id: currentFeedback.givenTo._id,
                name: `${currentFeedback.givenTo.firstName} ${currentFeedback.givenTo.lastName}`,
                employeeId: currentFeedback.givenTo.employeeId
            },
            periods: historicalFeedbacks.map(feedback => ({
                id: feedback._id,
                period: `${feedback.from.toISOString().split('T')[0]} to ${feedback.to.toISOString().split('T')[0]}`,
                from: feedback.from,
                to: feedback.to,
                overall: feedback.rating.overall,
                ratings: {
                    discipline: feedback.rating.discipline,
                    initiative: feedback.rating.initiative,
                    teamwork: feedback.rating.teamwork,
                    ownership: feedback.rating.ownership,
                    skillDevelopment: feedback.rating.skillDevelopment,
                    techSkills: feedback.rating.techSkills
                },
                sentiment: feedback.sentiment,
                sentimentScore: feedback.sentimentScore,
                givenBy: feedback.givenBy ? `${feedback.givenBy.firstName} ${feedback.givenBy.lastName}` : 'Unknown User',
                createdAt: feedback.createdAt
            })),
            currentPeriod: {
                id: currentFeedback._id,
                period: `${currentFeedback.from.toISOString().split('T')[0]} to ${currentFeedback.to.toISOString().split('T')[0]}`,
                from: currentFeedback.from,
                to: currentFeedback.to,
                overall: currentFeedback.rating.overall,
                ratings: {
                    discipline: currentFeedback.rating.discipline,
                    initiative: currentFeedback.rating.initiative,
                    teamwork: currentFeedback.rating.teamwork,
                    ownership: currentFeedback.rating.ownership,
                    skillDevelopment: currentFeedback.rating.skillDevelopment,
                    techSkills: currentFeedback.rating.techSkills
                },
                sentiment: currentFeedback.sentiment,
                sentimentScore: currentFeedback.sentimentScore,
                givenBy: `${currentFeedback.givenBy.firstName} ${currentFeedback.givenBy.lastName}`,
                createdAt: currentFeedback.createdAt
            }
        };

        // Calculate trend insights
        const allPeriods = [...trends.periods, trends.currentPeriod];
        if (allPeriods.length > 1) {
            const overallTrend = this.calculateTrend(allPeriods.map(p => p.overall));
            const sentimentTrend = this.calculateTrend(allPeriods.map(p => p.sentimentScore || 50));
            
            trends.insights = {
                overallTrend,
                sentimentTrend,
                totalPeriods: allPeriods.length,
                improvementAreas: this.identifyImprovementAreas(allPeriods),
                strengths: this.identifyStrengths(allPeriods),
                recommendations: this.generateTrendRecommendations(allPeriods, overallTrend, sentimentTrend)
            };
        }

        return trends;
    }

    calculateTrend(values) {
        if (values.length < 2) return 'insufficient_data';
        
        const firstHalf = values.slice(0, Math.ceil(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
        
        const change = secondAvg - firstAvg;
        
        if (Math.abs(change) < 0.2) return 'stable';
        return change > 0 ? 'improving' : 'declining';
    }

    identifyImprovementAreas(periods) {
        const skillNames = ['discipline', 'initiative', 'teamwork', 'ownership', 'skillDevelopment', 'techSkills'];
        const improvements = [];
        
        skillNames.forEach(skill => {
            const values = periods.map(p => p.ratings[skill]).filter(v => v !== undefined);
            if (values.length >= 2) {
                const currentValue = values[values.length - 1];
                const previousValue = values[values.length - 2];
                const trend = this.calculateTrend(values);
                const change = currentValue - previousValue;
                const avgValue = values.reduce((sum, val) => sum + val, 0) / values.length;
                
                // Determine priority based on multiple factors
                let priority = 'low';
                let reason = '';
                
                if (trend === 'declining') {
                    if (change < -0.5) {
                        priority = 'high';
                        reason = 'Rapid decline';
                    } else {
                        priority = 'medium';
                        reason = 'Gradual decline';
                    }
                } else if (trend === 'stable' && currentValue < 2.5) {
                    priority = 'high';
                    reason = 'Consistently low';
                } else if (trend === 'stable' && currentValue < 3.0) {
                    priority = 'medium';
                    reason = 'Below average';
                } else if (avgValue < 3.0 && currentValue < 3.5) {
                    priority = 'medium';
                    reason = 'Below target';
                }
                
                // Additional factors for priority
                if (currentValue < 2.0) {
                    priority = 'high';
                    reason = 'Critical level';
                }
                
                if (priority !== 'low') {
                    improvements.push({
                        skill,
                        currentValue,
                        previousValue,
                        change,
                        avgValue,
                        trend,
                        priority,
                        reason,
                        variance: this.calculateVariance(values)
                    });
                }
            }
        });
        
        return improvements.sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            if (priorityOrder[b.priority] !== priorityOrder[a.priority]) {
                return priorityOrder[b.priority] - priorityOrder[a.priority];
            }
            // If same priority, sort by current value (lower is worse)
            return a.currentValue - b.currentValue;
        });
    }

    identifyStrengths(periods) {
        const skillNames = ['discipline', 'initiative', 'teamwork', 'ownership', 'skillDevelopment', 'techSkills'];
        const strengths = [];
        
        skillNames.forEach(skill => {
            const values = periods.map(p => p.ratings[skill]).filter(v => v !== undefined);
            if (values.length >= 2) {
                const currentValue = values[values.length - 1];
                const previousValue = values[values.length - 2];
                const trend = this.calculateTrend(values);
                const change = currentValue - previousValue;
                const avgValue = values.reduce((sum, val) => sum + val, 0) / values.length;
                const consistency = this.calculateConsistency(values);
                
                // Determine if this is a strength
                let isStrength = false;
                let level = 'good';
                let reason = '';
                
                if (trend === 'improving' && currentValue >= 3.5) {
                    isStrength = true;
                    level = currentValue >= 4.5 ? 'excellent' : 'good';
                    reason = 'Improving trend';
                } else if (trend === 'stable' && currentValue >= 4.0) {
                    isStrength = true;
                    level = currentValue >= 4.5 ? 'excellent' : 'good';
                    reason = 'Consistently high';
                } else if (currentValue >= 4.5) {
                    isStrength = true;
                    level = 'excellent';
                    reason = 'Outstanding performance';
                } else if (avgValue >= 4.0 && currentValue >= 3.5) {
                    isStrength = true;
                    level = 'good';
                    reason = 'Above average';
                } else if (consistency > 0.8 && currentValue >= 3.5) {
                    isStrength = true;
                    level = 'good';
                    reason = 'Highly consistent';
                }
                
                if (isStrength) {
                    strengths.push({
                        skill,
                        currentValue,
                        previousValue,
                        change,
                        avgValue,
                        trend,
                        level,
                        reason,
                        consistency,
                        variance: this.calculateVariance(values)
                    });
                }
            }
        });
        
        return strengths.sort((a, b) => {
            const levelOrder = { excellent: 3, good: 2 };
            if (levelOrder[b.level] !== levelOrder[a.level]) {
                return levelOrder[b.level] - levelOrder[a.level];
            }
            // If same level, sort by current value (higher is better)
            return b.currentValue - a.currentValue;
        });
    }

    generateTrendRecommendations(periods, overallTrend, sentimentTrend) {
        const recommendations = [];
        const currentPeriod = periods[periods.length - 1];
        const previousPeriod = periods[periods.length - 2];
        const improvements = this.identifyImprovementAreas(periods);
        const strengths = this.identifyStrengths(periods);
        
        // Calculate performance metrics
        const currentOverall = currentPeriod.overall;
        const previousOverall = previousPeriod?.overall || currentOverall;
        const performanceChange = currentOverall - previousOverall;
        const avgSentiment = periods.reduce((sum, p) => sum + (p.sentimentScore || 50), 0) / periods.length;
        
        // 1. OVERALL PERFORMANCE TREND RECOMMENDATIONS
        if (overallTrend === 'declining') {
            if (performanceChange < -0.5) {
                recommendations.push({
                    type: 'urgent',
                    title: 'Rapid Performance Decline',
                    message: `Performance dropped significantly from ${previousOverall.toFixed(1)} to ${currentOverall.toFixed(1)}. Immediate intervention required.`,
                    action: 'Schedule urgent one-on-one meeting within 48 hours to address concerns and create immediate improvement plan.',
                    priority: 'high'
                });
            } else {
                recommendations.push({
                    type: 'urgent',
                    title: 'Performance Decline Detected',
                    message: 'Overall performance has been declining over multiple periods. Proactive intervention needed.',
                    action: 'Schedule one-on-one meeting to discuss concerns, identify root causes, and create improvement plan.',
                    priority: 'high'
                });
            }
        } else if (overallTrend === 'improving') {
            if (performanceChange > 0.5) {
                recommendations.push({
                    type: 'positive',
                    title: 'Significant Performance Improvement',
                    message: `Excellent progress! Performance improved from ${previousOverall.toFixed(1)} to ${currentOverall.toFixed(1)}.`,
                    action: 'Recognize achievements publicly, document success factors, and maintain current development approach.',
                    priority: 'medium'
                });
            } else {
                recommendations.push({
                    type: 'positive',
                    title: 'Steady Performance Improvement',
                    message: 'Good progress! Performance is trending upward. Continue current development approach.',
                    action: 'Provide positive feedback and maintain current support structure.',
                    priority: 'low'
                });
            }
        } else if (overallTrend === 'stable') {
            if (currentOverall >= 4.0) {
                recommendations.push({
                    type: 'positive',
                    title: 'Consistently High Performance',
                    message: 'Maintaining excellent performance levels. Focus on growth opportunities.',
                    action: 'Consider advanced projects, mentoring opportunities, or leadership development.',
                    priority: 'low'
                });
            } else if (currentOverall >= 3.0) {
                recommendations.push({
                    type: 'development',
                    title: 'Stable Performance - Growth Opportunity',
                    message: 'Performance is stable but has potential for improvement.',
                    action: 'Identify specific growth areas and create development plan to reach next level.',
                    priority: 'medium'
                });
            } else {
                recommendations.push({
                    type: 'concern',
                    title: 'Consistently Low Performance',
                    message: 'Performance has been consistently below expectations.',
                    action: 'Implement performance improvement plan with regular check-ins and clear milestones.',
                    priority: 'high'
                });
            }
        }

        // 2. SENTIMENT ANALYSIS RECOMMENDATIONS
        if (sentimentTrend === 'declining') {
            if (avgSentiment < 30) {
                recommendations.push({
                    type: 'urgent',
                    title: 'Critical Sentiment Decline',
                    message: 'Feedback sentiment has become significantly negative. Employee may be struggling.',
                    action: 'Schedule immediate check-in to address concerns, provide support, and identify underlying issues.',
                    priority: 'high'
                });
            } else {
                recommendations.push({
                    type: 'concern',
                    title: 'Sentiment Decline Detected',
                    message: 'Feedback sentiment has become more negative over time.',
                    action: 'Investigate underlying issues, provide additional support, and improve communication.',
                    priority: 'medium'
                });
            }
        } else if (sentimentTrend === 'improving') {
            recommendations.push({
                type: 'positive',
                title: 'Improving Sentiment',
                message: 'Feedback sentiment is becoming more positive, indicating better engagement.',
                action: 'Continue current approach and recognize the positive changes.',
                priority: 'low'
            });
        }

        // 3. SKILL-SPECIFIC RECOMMENDATIONS
        if (improvements.length > 0) {
            const highPriorityImprovements = improvements.filter(i => i.priority === 'high');
            const mediumPriorityImprovements = improvements.filter(i => i.priority === 'medium');
            
            if (highPriorityImprovements.length > 0) {
                recommendations.push({
                    type: 'development',
                    title: 'Critical Skill Gaps Identified',
                    message: `High priority areas needing immediate attention: ${highPriorityImprovements.map(i => i.skill).join(', ')}`,
                    action: 'Create intensive development plan with weekly check-ins and specific training resources.',
                    priority: 'high'
                });
            }
            
            if (mediumPriorityImprovements.length > 0) {
                recommendations.push({
                    type: 'development',
                    title: 'Skill Development Opportunities',
                    message: `Areas for improvement: ${mediumPriorityImprovements.map(i => i.skill).join(', ')}`,
                    action: 'Create targeted development plan with monthly progress reviews.',
                    priority: 'medium'
                });
            }
        }

        // 4. STRENGTHS-BASED RECOMMENDATIONS
        if (strengths.length > 0) {
            const excellentStrengths = strengths.filter(s => s.level === 'excellent');
            const goodStrengths = strengths.filter(s => s.level === 'good');
            
            if (excellentStrengths.length > 0) {
                recommendations.push({
                    type: 'positive',
                    title: 'Exceptional Strengths Identified',
                    message: `Outstanding performance in: ${excellentStrengths.map(s => s.skill).join(', ')}`,
                    action: 'Leverage these strengths for advanced projects, mentoring opportunities, or leadership roles.',
                    priority: 'low'
                });
            }
            
            if (goodStrengths.length > 0) {
                recommendations.push({
                    type: 'positive',
                    title: 'Strong Performance Areas',
                    message: `Consistently good performance in: ${goodStrengths.map(s => s.skill).join(', ')}`,
                    action: 'Continue developing these areas and consider them for future project assignments.',
                    priority: 'low'
                });
            }
        }

        // 5. CONSISTENCY ANALYSIS
        const ratingVariance = this.calculateRatingVariance(periods);
        if (ratingVariance > 0.8) {
            recommendations.push({
                type: 'concern',
                title: 'Inconsistent Performance',
                message: 'Performance shows high variability across periods, indicating potential issues.',
                action: 'Investigate factors causing inconsistency and create stability plan.',
                priority: 'medium'
            });
        } else if (ratingVariance < 0.2 && periods.length > 2) {
            recommendations.push({
                type: 'development',
                title: 'Highly Consistent Performance',
                message: 'Performance is very consistent, indicating reliable work patterns.',
                action: 'Consider for projects requiring consistency and reliability.',
                priority: 'low'
            });
        }

        // 6. PROGRESSION ANALYSIS
        if (periods.length >= 3) {
            const progression = this.analyzeProgression(periods);
            if (progression === 'accelerating') {
                recommendations.push({
                    type: 'positive',
                    title: 'Accelerating Improvement',
                    message: 'Performance improvement is accelerating, showing great potential.',
                    action: 'Provide challenging opportunities and consider for promotion pipeline.',
                    priority: 'low'
                });
            } else if (progression === 'plateauing') {
                recommendations.push({
                    type: 'development',
                    title: 'Performance Plateau',
                    message: 'Performance has plateaued after initial improvement.',
                    action: 'Introduce new challenges and development opportunities to break the plateau.',
                    priority: 'medium'
                });
            }
        }

        // 7. COMPARATIVE ANALYSIS
        const teamAverage = this.calculateTeamAverage(periods); // This would need team data
        if (currentOverall > teamAverage + 0.5) {
            recommendations.push({
                type: 'positive',
                title: 'Above-Average Performance',
                message: 'Performance is significantly above team average.',
                action: 'Consider for leadership opportunities and advanced responsibilities.',
                priority: 'low'
            });
        } else if (currentOverall < teamAverage - 0.5) {
            recommendations.push({
                type: 'concern',
                title: 'Below-Average Performance',
                message: 'Performance is below team average and needs attention.',
                action: 'Provide additional support and consider peer mentoring opportunities.',
                priority: 'high'
            });
        }

        // Sort recommendations by priority
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
    }

    calculateRatingVariance(periods) {
        const ratings = periods.map(p => p.overall);
        const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
        const variance = ratings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / ratings.length;
        return Math.sqrt(variance);
    }

    analyzeProgression(periods) {
        if (periods.length < 3) return 'insufficient_data';
        
        const recent = periods.slice(-2);
        const earlier = periods.slice(-3, -1);
        
        const recentChange = recent[1].overall - recent[0].overall;
        const earlierChange = earlier[1].overall - earlier[0].overall;
        
        if (recentChange > earlierChange + 0.2) return 'accelerating';
        if (Math.abs(recentChange) < 0.1) return 'plateauing';
        return 'stable';
    }

    calculateTeamAverage(periods) {
        // This would typically query team data
        // For now, return a mock average
        return 3.5;
    }

    calculateVariance(values) {
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    calculateConsistency(values) {
        if (values.length < 2) return 1;
        const variance = this.calculateVariance(values);
        // Lower variance = higher consistency
        return Math.max(0, 1 - (variance / 2));
    }
}

module.exports = new FeedbacksService();
