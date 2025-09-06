const httpStatus = require('http-status-codes');
const catchAsync = require('../utility/catchAsync');
const aiService = require('../services/aiService');
const logger = require('../config/logger');

const testAI = catchAsync(async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'Text is required for AI analysis'
    });
  }

  logger.info('Testing AI service with text:', text);

  try {
    const analysis = await aiService.analyzeFeedback(text);
    
    res.status(httpStatus.OK).json({
      success: true,
      data: {
        originalText: text,
        aiAnalysis: analysis,
        serviceStatus: {
          enabled: aiService.enabled,
          hasApiKey: !!aiService.geminiApiKey,
          baseUrl: aiService.geminiBaseUrl
        }
      }
    });
  } catch (error) {
    logger.error('AI test failed:', error);
    
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'AI analysis failed',
      error: error.message,
      serviceStatus: {
        enabled: aiService.enabled,
        hasApiKey: !!aiService.geminiApiKey,
        baseUrl: aiService.geminiBaseUrl
      }
    });
  }
});

const getAIStatus = catchAsync(async (req, res) => {
  res.status(httpStatus.OK).json({
    success: true,
    data: {
      enabled: aiService.enabled,
      hasApiKey: !!aiService.geminiApiKey,
      baseUrl: aiService.geminiBaseUrl,
      environment: {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'Set' : 'Not Set',
        GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || 'Using default'
      }
    }
  });
});

const testConnection = catchAsync(async (req, res) => {
  try {
    const result = await aiService.testConnection();
    
    res.status(httpStatus.OK).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Connection test failed:', error);
    
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Connection test failed',
      error: error.message
    });
  }
});

module.exports = {
  testAI,
  getAIStatus,
  testConnection
};
