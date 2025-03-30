// src/expressServer.js
const { default: httpStatus } = require('http-status');
const { app } = require('./server'); // Import the configured app
const mainRouter = require('./routes'); // Import the main router from routes.js
const ApiError = require('./utility/ApiError'); // Import ApiError utility

// *** IMPORT YOUR ERROR MIDDLEWARE HERE ***
const {
  errorConverter,
  errorHandler,
} = require('./middleware/errorMiddleware');

app.get('/', (req, res) =>
  res.status(200).send('HRMS Backend API is running...')
);
app.get('/health', (req, res) => res.status(200).json({ status: 'UP' })); // Health check endpoint

// Mount API routes
app.use(mainRouter);

// --- Error Handling Middleware (Should be last) ---

// Catch 404 for any request that doesn't match previous routes and forward to error handler
app.use((req, res, next) => {
  // Create an ApiError for 404 situations
  next(new ApiError(httpStatus.NOT_FOUND, 'API endpoint not found'));
});

// 1. Convert errors to ApiError, if necessary
// This catches errors passed via next(err) from anywhere before it (like controllers using catchAsync)
// It also catches errors from the 404 handler above
app.use(errorConverter);

// 2. Handle the errors
// This takes the (potentially converted) ApiError and sends the final response to the client
app.use(errorHandler);

const PORT = process.env.PORT || 3301;
app.listen(PORT, (err) => {
  if (err) {
    return console.error('Failed to start server:', err);
  }
  console.log(`🚀 Server is listening on Port : ${PORT}`);
});
