const multer = require('multer');
const ApiError  = require('../utility/ApiError');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Images + PDF (common browser / mobile variants)
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new ApiError(
        400,
        'Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDF files are allowed'
      ),
      false
    );
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
          // Allow unexpected files (optional documents)
          return next();
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

// One optional/mandatory file, any field name (avoids LIMIT_UNEXPECTED_FILE when UI uses random keys)
const uploadExpenseAttachment = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fieldSize: 8 * 1024 * 1024,
  },
  fileFilter,
});

const respondMulterError = (res, err) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          status: false,
          message: 'File too large. Max size is 5MB',
          error: err.code,
        });
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_PART_COUNT':
        return res.status(400).json({
          status: false,
          message: 'Only one attachment is allowed per expense',
          error: err.code,
        });
      default:
        return res.status(400).json({
          status: false,
          message: err.message || 'File upload failed',
          error: err.code,
        });
    }
  }
  const status = err.statusCode || 500;
  return res.status(status).json({
    status: false,
    message: err.message || 'File upload failed',
    error: err.code,
  });
};

/** Single image/PDF under any multipart field name (e.g. receipt, attachment, file). */
const safeSingleAttachmentUpload = (req, res, next) => {
  uploadExpenseAttachment.any()(req, res, (err) => {
    if (err) return respondMulterError(res, err);
    next();
  });
};

/** Expense create: accept a single file under any multipart field name (e.g. receipt, attachment, file). */
const safeExpenseAttachmentUpload = safeSingleAttachmentUpload;

/** Leave apply: accept a single optional attachment (image or PDF). */
const safeLeaveAttachmentUpload = safeSingleAttachmentUpload;

// Helper to wrap multer middleware with error handling
const safeUpload = (fields) => {
  return (req, res, next) => {
    let uploadMiddleware;

    if (fields.length === 0) {
      uploadMiddleware = upload.any();
    } else if (fields.length === 1 && typeof fields[0] === 'string') {
      uploadMiddleware = upload.single(fields[0]);
    } else if (fields.every((f) => typeof f === 'string')) {
      uploadMiddleware = upload.fields(
        fields.map((name) => ({ name, maxCount: 1 }))
      );
    } else {
      uploadMiddleware = upload.fields(fields);
    }

    uploadMiddleware(req, res, (err) => {
      if (err) {
        return respondMulterError(res, err);
      }
      next();
    });
  };
};

module.exports = {
  upload,
  safeUpload,
  safeExpenseAttachmentUpload,
  safeLeaveAttachmentUpload,
};