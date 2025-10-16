// const { setupCache } = require('axios-cache-interceptor');
// const axios = require('axios');
// const catchAsync = require('../utility/catchAsync');

// // Set up Axios with caching
// const api = setupCache(axios);



// exports.getQuotes = catchAsync(async (req, res) => {
//   try {
//     const url = `https://api.api-ninjas.com/v1/quotes`;

//     const response = await api.get(url, {
//       headers: {
//         'X-Api-Key': process.env.QUOTES_API_KEY
//       },
//       cache: {
//         ttl: 60 * 5 * 1000, 
//         interpretHeader: false
//       }
//     });

//     const quotes = response.data || [];

//     const unsafeWords = ['sex', 'naked', 'drugs', 'violence'];

//     const filteredQuotes = quotes.filter(q =>
//       !unsafeWords.some(word => q.quote.toLowerCase().includes(word))
//     );

//     const randomQuote = filteredQuotes[Math.floor(Math.random() * filteredQuotes.length)] || {};

//     res.status(200).json({
//       success: true,
//       data: randomQuote
//     });

//   } catch (err) {
//     console.error("Quote fetch error:", err);
//     res.status(500).json({
//       success: false,
//       message: "Could not retrieve quote."
//     });
//   }
// });


const catchAsync = require('../utility/catchAsync');

// Predefined safe quotes (HRMS-friendly, all with authors)
const safeQuotes = [
  { quote: "Success is not the key to happiness. Happiness is the key to success.", author: "Albert Schweitzer" },
  { quote: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { quote: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { quote: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { quote: "Opportunities don't happen, you create them.", author: "Chris Grosser" },
  { quote: "Dream big and dare to fail.", author: "Norman Vaughan" },
  { quote: "Don't be afraid to give up the good to go for the great.", author: "John D. Rockefeller" },
  { quote: "Success doesn’t just find you. You have to go out and get it.", author: "Marva Collins" },
  { quote: "Push yourself, because no one else is going to do it for you.", author: "Les Brown" },
  { quote: "Great things never come from comfort zones.", author: "Roy T. Bennett" },
  { quote: "The harder you work for something, the greater you’ll feel when you achieve it.", author: "Michael Jordan" },
  { quote: "Dream it. Wish it. Do it.", author: "Richard Branson" },
  { quote: "Little things make big days.", author: "Isabel Marant" },
  { quote: "Don’t stop when you’re tired. Stop when you’re done.", author: "Marilyn Monroe" },
  { quote: "Wake up with determination. Go to bed with satisfaction.", author: "George Lorimer" },
  { quote: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" },
  { quote: "It always seems impossible until it’s done.", author: "Nelson Mandela" },
  { quote: "Good things come to people who wait, but better things come to those who go out and get them.", author: "Abraham Lincoln" },
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "Quality means doing it right when no one is looking.", author: "Henry Ford" }
];

exports.getQuotes = catchAsync(async (req, res) => {
  try {
    // Pick a random safe quote
    const randomQuote = safeQuotes[Math.floor(Math.random() * safeQuotes.length)];

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
