# hrms-backend

## AI Integration

The feedback module now uses OpenAI API for sentiment analysis and text processing. 

### Required Environment Variables:

```
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
```

### Migration from Gemini API

The system has been migrated from Google Gemini API to OpenAI API. The following environment variables are no longer needed:
- `GEMINI_API_KEY` (replaced with `OPENAI_API_KEY`)
- `GEMINI_BASE_URL` (no longer needed)