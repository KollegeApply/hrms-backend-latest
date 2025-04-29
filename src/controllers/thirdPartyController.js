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
        ttl: 60 * 60 * 24 * 1000, // 24 hours in milliseconds
        interpretHeader: false,
        key: 'daily-quote'
      }
    });

    const data = response.data;
    // console.log('Cached quote:', data);

    res.status(200).json({
      success: true,
      data: data[0] || {}
    });

  } catch (err) {
    console.error("Quote fetch error:", err);
    res.status(500).json({
      success: false,
      message: "Could not retrieve quote."
    });
  }
});
