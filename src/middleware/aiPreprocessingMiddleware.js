const aiService = require('../services/aiService');
const logger = require('../config/logger');

/**
 * AI Preprocessing Middleware
 * Analyzes form data and adds AI insights before processing
 */
class AIPreprocessingMiddleware {
  
  /**
   * Middleware for feedback form preprocessing
   */
  static async preprocessFeedback(req, res, next) {
    try {
      // Handle both formats: { data: { feedback: ... } } and { feedback: ... }
      let feedbackData = req.body.data || req.body;
      let isWrapped = !!req.body.data;
      
      logger.info('AI Preprocessing middleware called', { 
        hasData: !!req.body.data,
        hasDirectFeedback: !!req.body.feedback,
        isWrapped,
        feedbackLength: feedbackData?.feedback?.length 
      });
      
      if (!feedbackData || !feedbackData.feedback) {
        logger.warn('No feedback data found, skipping AI preprocessing');
        return next();
      }

      logger.info('Starting AI preprocessing for feedback submission', {
        feedback: feedbackData.feedback.substring(0, 100)
      });

      // Analyze feedback text
      const aiAnalysis = await aiService.analyzeFeedback(feedbackData.feedback);
      
      logger.info('AI analysis completed', aiAnalysis);
      
      // Add AI analysis to the appropriate structure
      if (isWrapped) {
        // Original format: { data: { feedback: ..., sentiment: ... } }
        req.body.data = {
          ...feedbackData,
          ...aiAnalysis
        };
      } else {
        // Direct format: { feedback: ..., sentiment: ... }
        req.body = {
          ...feedbackData,
          ...aiAnalysis
        };
      }

      logger.info('AI preprocessing completed for feedback', {
        sentiment: aiAnalysis.sentiment,
        sentimentScore: aiAnalysis.sentimentScore,
        keywordsCount: aiAnalysis.keywords.length,
        hasRecommendation: !!aiAnalysis.recommendation
      });

      next();
    } catch (error) {
      logger.error('AI preprocessing failed for feedback:', error.message, error.stack);
      // Continue without AI analysis if it fails
      next();
    }
  }

  /**
   * Middleware for candidate form preprocessing
   */
  static async preprocessCandidateForm(req, res, next) {
    try {
      const parsedBody = req.body;
      
      if (!parsedBody || typeof parsedBody !== 'object') {
        return next();
      }

      logger.info('Starting AI preprocessing for candidate form submission');

      // Analyze candidate form data
      const aiAnalysis = await aiService.analyzeCandidateForm(parsedBody);
      
      // Add AI analysis to request body
      req.body = {
        ...parsedBody,
        aiAnalysis
      };

      logger.info('AI preprocessing completed for candidate form', {
        sentiment: aiAnalysis.sentiment,
        sentimentScore: aiAnalysis.sentimentScore,
        keywordsCount: aiAnalysis.keywords.length
      });

      next();
    } catch (error) {
      logger.error('AI preprocessing failed for candidate form:', error);
      // Continue without AI analysis if it fails
      next();
    }
  }

  /**
   * Generic middleware for any form with text fields
   */
  static preprocessForm(textFields, context = 'general') {
    return async (req, res, next) => {
      try {
        const data = req.body;
        
        if (!data || typeof data !== 'object') {
          return next();
        }

        logger.info(`Starting AI preprocessing for ${context} form`);

        // Extract text fields for analysis
        const textsToAnalyze = textFields
          .map(field => {
            const value = this.getNestedValue(data, field);
            return typeof value === 'string' ? value : '';
          })
          .filter(text => text.trim().length > 0);

        if (textsToAnalyze.length === 0) {
          return next();
        }

        // Analyze all text fields
        const aiAnalysis = await aiService.analyzeMultipleFields(textsToAnalyze, context);
        
        // Add AI analysis to request body
        req.body = {
          ...data,
          aiAnalysis
        };

        logger.info(`AI preprocessing completed for ${context} form`, {
          sentiment: aiAnalysis.sentiment,
          sentimentScore: aiAnalysis.sentimentScore,
          keywordsCount: aiAnalysis.keywords.length,
          fieldsAnalyzed: textsToAnalyze.length
        });

        next();
      } catch (error) {
        logger.error(`AI preprocessing failed for ${context} form:`, error);
        // Continue without AI analysis if it fails
        next();
      }
    };
  }

  /**
   * Helper to get nested object values using dot notation
   */
  static getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * Middleware for leave application preprocessing
   */
  static async preprocessLeaveApplication(req, res, next) {
    const textFields = ['reason', 'description', 'comments'];
    return AIPreprocessingMiddleware.preprocessForm(textFields, 'leave_application')(req, res, next);
  }

  /**
   * Middleware for regularization request preprocessing
   */
  static async preprocessRegularization(req, res, next) {
    const textFields = ['reason', 'description', 'comments'];
    return AIPreprocessingMiddleware.preprocessForm(textFields, 'regularization')(req, res, next);
  }

  /**
   * Middleware for WFH request preprocessing
   */
  static async preprocessWFHRequest(req, res, next) {
    const textFields = ['reason', 'description', 'comments'];
    return AIPreprocessingMiddleware.preprocessForm(textFields, 'wfh_request')(req, res, next);
  }

  /**
   * Middleware for ticket creation preprocessing
   */
  static async preprocessTicket(req, res, next) {
    const textFields = ['title', 'description', 'comments'];
    return AIPreprocessingMiddleware.preprocessForm(textFields, 'ticket')(req, res, next);
  }

  /**
   * Middleware for asset request preprocessing
   */
  static async preprocessAssetRequest(req, res, next) {
    const textFields = ['reason', 'description', 'comments'];
    return AIPreprocessingMiddleware.preprocessForm(textFields, 'asset_request')(req, res, next);
  }

  /**
   * Utility method to check if AI service is enabled
   */
  static isAIEnabled() {
    return aiService.enabled;
  }

  /**
   * Utility method to get AI service status
   */
  static getAIStatus() {
    return {
      enabled: aiService.enabled,
      hasApiKey: !!aiService.geminiApiKey,
      baseUrl: aiService.geminiBaseUrl
    };
  }
}

module.exports = AIPreprocessingMiddleware;
