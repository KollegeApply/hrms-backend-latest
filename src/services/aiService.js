const OpenAI = require('openai');
const logger = require('../config/logger');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.enabled = !!this.openaiApiKey;
    
    if (this.enabled) {
      this.openai = new OpenAI({
        apiKey: this.openaiApiKey,
      });
    }
  }

  /**
   * Analyze text for sentiment, keywords, and generate recommendations
   * @param {string} text - The text to analyze
   * @param {string} context - Context of the text (e.g., 'feedback', 'candidate_form')
   * @returns {Object} Analysis results
   */
  async analyzeText(text, context = 'general') {
    if (!this.enabled) {
      logger.warn('AI Service is disabled - no OpenAI API key provided');
      return this.getDefaultAnalysis();
    }

    try {
      const prompt = this.buildAnalysisPrompt(text, context);
      const response = await this.callOpenAIAPI(prompt);
      return this.parseAnalysisResponse(response);
    } catch (error) {
      logger.error('AI analysis failed:', error);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Build analysis prompt based on context
   */
  buildAnalysisPrompt(text, context) {
    const basePrompt = `Analyze the following text and provide structured analysis in JSON format.`;
    
    const contextPrompts = {
      feedback: `
        Analyze this employee feedback text and respond with ONLY a valid JSON object. Do not include any other text, explanations, or formatting.

        Text to analyze: "${text}"

        Required JSON format:
        {
          "sentiment": "Positive",
          "sentimentScore": 75,
          "keywords": ["leadership", "communication", "teamwork"],
          "recommendation": "Continue developing leadership skills and consider mentoring opportunities"
        }

        Rules:
        - sentiment must be exactly "Positive", "Neutral", or "Negative"
        - sentimentScore must be a number between 0-100
        - keywords must be an array of 3-5 relevant strings
        - recommendation must be a helpful string (can be empty if no specific recommendation)

        Respond with ONLY the JSON object:`,

      candidate_form: `
        For this candidate information form text, analyze:
        1. Overall sentiment (Positive, Neutral, Negative)
        2. Sentiment score (0-100)
        3. Key skills/qualities mentioned
        4. Recommendation for HR review
        
        Text: "${text}"
        
        Respond with JSON only:
        {
          "sentiment": "Positive|Neutral|Negative",
          "sentimentScore": number,
          "keywords": ["skill1", "quality1", "skill2"],
          "recommendation": "HR review recommendation"
        }`,

      general: `
        Analyze this text for:
        1. Sentiment (Positive, Neutral, Negative)
        2. Sentiment score (0-100)
        3. Key topics/keywords
        4. Brief summary or insight
        
        Text: "${text}"
        
        Respond with JSON only:
        {
          "sentiment": "Positive|Neutral|Negative",
          "sentimentScore": number,
          "keywords": ["topic1", "topic2", "topic3"],
          "recommendation": "brief insight or summary"
        }`
    };

    return basePrompt + (contextPrompts[context] || contextPrompts.general);
  }

  /**
   * Call OpenAI API
   */
  async callOpenAIAPI(prompt) {
    logger.info('Calling OpenAI API', { 
      model: this.openaiModel,
      hasApiKey: !!this.openaiApiKey,
      promptLength: prompt.length 
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that analyzes text and provides structured JSON responses. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
        top_p: 0.8,
      });

      logger.info('OpenAI API response received', { 
        id: response.id,
        model: response.model,
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        usage: response.usage
      });
      
      // Log the full response structure for debugging
      logger.info('Full OpenAI response structure:', JSON.stringify(response, null, 2));

      if (!response.choices || response.choices.length === 0) {
        logger.error('No choices in OpenAI API response');
        throw new Error('No choices in OpenAI API response');
      }

      const choice = response.choices[0];
      
      logger.info('First choice structure:', JSON.stringify(choice, null, 2));
      
      if (!choice.message || !choice.message.content) {
        logger.error('Invalid response structure from OpenAI API', choice);
        throw new Error('Invalid response structure from OpenAI API');
      }

      const text = choice.message.content.trim();
      logger.info('Extracted text from OpenAI response:', text);
      
      if (!text || text.length === 0) {
        logger.error('Empty response from OpenAI API');
        throw new Error('Empty response from OpenAI API');
      }
      
      return text;
    } catch (error) {
      logger.error('OpenAI API call failed:', {
        message: error.message,
        type: error.type,
        code: error.code,
        status: error.status
      });
      throw error;
    }
  }

  /**
   * Parse AI response and validate structure
   */
  parseAnalysisResponse(response) {
    try {
      logger.info('Raw AI response:', response);
      
      // Clean the response - remove any markdown formatting or extra text
      let cleanResponse = response.trim();
      
      // Remove markdown code blocks if present
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      // Try to extract JSON from the response if it's wrapped in text
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }
      
      logger.info('Cleaned response for parsing:', cleanResponse);
      
      const parsed = JSON.parse(cleanResponse);
      
      // Validate and sanitize response
      const result = {
        sentiment: this.validateSentiment(parsed.sentiment),
        sentimentScore: this.validateScore(parsed.sentimentScore),
        keywords: this.validateKeywords(parsed.keywords),
        recommendation: this.validateRecommendation(parsed.recommendation)
      };
      
      logger.info('Successfully parsed AI response:', result);
      return result;
    } catch (error) {
      logger.error('Failed to parse AI response:', error.message);
      logger.error('Response that failed to parse:', response);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Validate sentiment value
   */
  validateSentiment(sentiment) {
    const validSentiments = ['Positive', 'Neutral', 'Negative'];
    return validSentiments.includes(sentiment) ? sentiment : 'Neutral';
  }

  /**
   * Validate sentiment score
   */
  validateScore(score) {
    const numScore = Number(score);
    return (numScore >= 0 && numScore <= 100) ? numScore : 50;
  }

  /**
   * Validate keywords array
   */
  validateKeywords(keywords) {
    if (!Array.isArray(keywords)) return [];
    return keywords
      .filter(k => typeof k === 'string' && k.trim().length > 0)
      .map(k => k.trim().toLowerCase())
      .slice(0, 5); // Limit to 5 keywords
  }

  /**
   * Validate recommendation text
   */
  validateRecommendation(recommendation) {
    return typeof recommendation === 'string' ? recommendation.trim() : '';
  }

  /**
   * Get default analysis when AI is unavailable
   */
  getDefaultAnalysis() {
    return {
      sentiment: 'Neutral',
      sentimentScore: 50,
      keywords: [],
      recommendation: ''
    };
  }

  /**
   * Test OpenAI API connection
   */
  async testConnection() {
    if (!this.enabled) {
      return { success: false, error: 'AI service disabled - no API key' };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.openaiModel,
        messages: [
          {
            role: 'user',
            content: 'Hello, respond with just "OK"'
          }
        ],
        temperature: 0.1,
        max_tokens: 10
      });

      logger.info('OpenAI API test response:', response);
      return { success: true, response: response };
    } catch (error) {
      logger.error('OpenAI API test failed:', error);
      return { 
        success: false, 
        error: error.message,
        type: error.type,
        code: error.code,
        status: error.status
      };
    }
  }

  /**
   * Analyze feedback text specifically
   */
  async analyzeFeedback(feedbackText) {
    try {
      const analysis = await this.analyzeText(feedbackText, 'feedback');
      
      // If we get default values, try a simpler prompt
      if (analysis.sentiment === 'Neutral' && analysis.sentimentScore === 50 && analysis.keywords.length === 0) {
        logger.info('Got default analysis, trying simpler prompt');
        return await this.analyzeTextSimple(feedbackText);
      }
      
      return analysis;
    } catch (error) {
      logger.error('Feedback analysis failed, using fallback:', error.message);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Simple analysis with basic prompt
   */
  async analyzeTextSimple(text) {
    if (!this.enabled) {
      return this.getDefaultAnalysis();
    }

    try {
      const simplePrompt = `Analyze this text: "${text}"

Respond with JSON only:
{
  "sentiment": "Positive",
  "sentimentScore": 75,
  "keywords": ["keyword1", "keyword2"],
  "recommendation": "Some recommendation"
}`;

      const response = await this.callOpenAIAPI(simplePrompt);
      return this.parseAnalysisResponse(response);
    } catch (error) {
      logger.error('Simple analysis failed:', error.message);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Analyze candidate form data
   */
  async analyzeCandidateForm(formData) {
    // Combine relevant text fields for analysis
    const textFields = [
      formData.personalInfo?.bio,
      formData.workExperience?.map(exp => exp.description).join(' '),
      formData.education?.map(edu => edu.description).join(' '),
      formData.skills?.join(' '),
      formData.additionalInfo
    ].filter(Boolean).join(' ');

    if (!textFields.trim()) {
      return this.getDefaultAnalysis();
    }

    return await this.analyzeText(textFields, 'candidate_form');
  }

  /**
   * Analyze multiple text fields and combine results
   */
  async analyzeMultipleFields(fields, context = 'general') {
    const results = await Promise.all(
      fields.map(field => this.analyzeText(field, context))
    );

    // Combine results intelligently
    return this.combineAnalysisResults(results);
  }

  /**
   * Combine multiple analysis results
   */
  combineAnalysisResults(results) {
    if (results.length === 0) return this.getDefaultAnalysis();
    if (results.length === 1) return results[0];

    // Calculate average sentiment score
    const avgScore = results.reduce((sum, r) => sum + r.sentimentScore, 0) / results.length;
    
    // Determine overall sentiment based on average score
    let overallSentiment = 'Neutral';
    if (avgScore > 60) overallSentiment = 'Positive';
    else if (avgScore < 40) overallSentiment = 'Negative';

    // Combine keywords (remove duplicates)
    const allKeywords = results.flatMap(r => r.keywords);
    const uniqueKeywords = [...new Set(allKeywords)].slice(0, 5);

    // Combine recommendations
    const recommendations = results
      .map(r => r.recommendation)
      .filter(r => r.trim().length > 0)
      .join('; ');

    return {
      sentiment: overallSentiment,
      sentimentScore: Math.round(avgScore),
      keywords: uniqueKeywords,
      recommendation: recommendations
    };
  }
}

module.exports = new AIService();
