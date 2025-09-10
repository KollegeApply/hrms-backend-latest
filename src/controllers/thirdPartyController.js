const { setupCache } = require('axios-cache-interceptor');
const axios = require('axios');
const catchAsync = require('../utility/catchAsync');

// Set up Axios with caching
const api = setupCache(axios);



exports.getQuotes = catchAsync(async (req, res) => {
  try {
    const url = `https://api.api-ninjas.com/v1/quotes`;

    const response = await api.get(url, {
      headers: {
        'X-Api-Key': process.env.QUOTES_API_KEY
      },
      cache: {
        ttl: 60 * 5 * 1000, 
        interpretHeader: false
      }
    });

    const quotes = response.data || [];

    const unsafeWords = ['sex', 'naked', 'drugs', 'violence'];

    const filteredQuotes = quotes.filter(q =>
      !unsafeWords.some(word => q.quote.toLowerCase().includes(word))
    );

    const randomQuote = filteredQuotes[Math.floor(Math.random() * filteredQuotes.length)] || {};

    res.status(200).json({
      success: true,
      data: randomQuote
    });

  } catch (err) {
    console.error("Quote fetch error:", err);
    res.status(500).json({
      success: false,
      message: "Could not retrieve quote."
    });
  }
});


