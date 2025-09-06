# AI Integration with Gemini API

This document explains the AI integration implemented in the HRMS backend for form preprocessing using Google's Gemini API.

## Overview

The AI integration provides automatic text analysis for feedback submissions, including:
- Sentiment analysis (Positive, Neutral, Negative)
- Sentiment scoring (0-100)
- Keyword extraction
- AI-generated recommendations

## Files Added/Modified

### New Files
1. `src/services/aiService.js` - Core AI service using Gemini API
2. `src/middleware/aiPreprocessingMiddleware.js` - Middleware for form preprocessing

### Modified Files
1. `src/services/feedbackService.js` - Added AI analysis to feedback creation
2. `src/routes/feedbackRoute.js` - Added AI preprocessing middleware
3. `package.json` - Added `@google/generative-ai` dependency

## Environment Configuration

Add the following environment variables to your `.env` file:

```env
# Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

## How It Works

### 1. Feedback Submission Flow
```
POST /feedback → AI Preprocessing Middleware → Feedback Controller → Feedback Service
```

### 2. AI Analysis Process
1. **Text Extraction**: Extracts feedback text from the request
2. **Gemini API Call**: Sends text to Gemini for analysis
3. **Response Parsing**: Parses and validates AI response
4. **Data Enhancement**: Adds AI insights to the feedback data
5. **Database Storage**: Saves feedback with AI analysis

### 3. AI Analysis Fields
The feedback model now includes these AI-enhanced fields:
- `sentiment`: Positive, Neutral, or Negative
- `sentimentScore`: Numeric score (0-100)
- `keywords`: Array of extracted keywords
- `aiRecommendation`: AI-generated actionable insights

## API Usage

### Feedback Creation with AI Analysis
```javascript
POST /api/feedback
{
  "data": {
    "givenTo": "user_id",
    "from": "2024-01-01",
    "to": "2024-01-31",
    "feedback": "John has shown excellent leadership skills and great initiative in completing projects ahead of schedule.",
    "rating": {
      "discipline": 5,
      "initiative": 5,
      "teamwork": 4,
      "ownership": 5,
      "skillDevelopment": 4,
      "techSkills": 4
    }
  },
  "sendMail": true
}
```

### Response with AI Analysis
```javascript
{
  "success": true,
  "data": {
    "_id": "feedback_id",
    "feedback": "John has shown excellent leadership skills...",
    "sentiment": "Positive",
    "sentimentScore": 85,
    "keywords": ["leadership", "initiative", "projects", "schedule"],
    "aiRecommendation": "Consider promoting John to a leadership role and provide advanced project management training.",
    "rating": { ... },
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

## Error Handling

The AI integration is designed to be resilient:
- If Gemini API is unavailable, feedback creation continues with default values
- If API key is missing, AI analysis is skipped
- All errors are logged but don't break the main functionality

## Installation

1. Install the new dependency:
```bash
npm install @google/generative-ai
```

2. Add environment variables to your `.env` file

3. Restart the server

## Testing

To test the AI integration:

1. Ensure you have a valid Gemini API key
2. Submit a feedback with descriptive text
3. Check the response for AI analysis fields
4. Verify the feedback is saved with AI insights in the database

## Future Enhancements

The middleware is designed to be extensible for other forms:
- Leave applications
- Regularization requests
- WFH requests
- Ticket creation
- Asset requests

Simply add the appropriate middleware to the respective routes.

## Troubleshooting

### Common Issues

1. **AI Analysis Not Working**
   - Check if `GEMINI_API_KEY` is set correctly
   - Verify the API key has proper permissions
   - Check server logs for API errors

2. **Slow Response Times**
   - Gemini API calls have a 15-second timeout
   - Consider implementing caching for repeated analyses
   - Monitor API usage limits

3. **Invalid AI Responses**
   - The service includes validation and fallback to default values
   - Check logs for parsing errors
   - Verify Gemini API response format

## Security Considerations

- API keys are stored in environment variables
- AI analysis is performed server-side only
- No sensitive data is sent to external APIs beyond the feedback text
- All API calls include proper error handling and timeouts
