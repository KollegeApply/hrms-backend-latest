const multer = require('multer');
const  ApiError = require('../utility/ApiError');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Allow only specific mime types
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/pdf'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Invalid file type. Only JPEG, PNG and PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 20, // Max number of files
    fieldSize: 8 * 1024 * 1024 // 8MB field size limit
  },
  fileFilter,
  onError: function(err, next) {
    if (err instanceof multer.MulterError) {
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          return next(new ApiError(400, 'File too large. Max size is 5MB'));
        case 'LIMIT_UNEXPECTED_FILE':
          return next(new ApiError(400, 'Unexpected file upload field'));
        case 'LIMIT_FIELD_KEY':
          return next(new ApiError(400, 'Field name too long'));
        case 'LIMIT_FIELD_VALUE': 
          return next(new ApiError(400, 'Field value too long'));
        case 'LIMIT_FIELD_COUNT':
          return next(new ApiError(400, 'Too many fields'));
        case 'LIMIT_PART_COUNT':
          return next(new ApiError(400, 'Too many parts'));
        default:
          return next(new ApiError(400, err.message));
      }
    }

    if (err.message === 'Unexpected end of form') {
      return next(new ApiError(400, 'Upload was interrupted. Please try again.'));
    }

    next(err);
  }
});

// Helper to wrap multer middleware with error handling
const safeUpload = (fields) => {
  return (req, res, next) => {
    const uploadMiddleware = upload.fields(fields);
    
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(err.statusCode || 500).json({
          status: false,
          message: err.message || 'File upload failed',
          error: err.code
        });
      }
      next();
    });
  };
};

module.exports = { upload, safeUpload };