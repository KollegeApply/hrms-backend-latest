// src/utility/common.js
const mongoose = require('mongoose');
const { bulkCreateUserRowSchema } = require('../validators/userValidator');
const { format } = require('date-fns-tz');
const jwt = require('jsonwebtoken');
const candidateModel = require('../models/candidateModel');
const User = require('../models/userModel');
/**
 * Paginates Mongoose query results.
 * @param {mongoose.Model} model - The Mongoose model to query.
 * @param {mongoose.FilterQuery} query - The filter query object.
 * @param {number} page - The current page number (1-based).
 * @param {number} pageSize - The number of documents per page.
 * @param {object} [sort={ createdAt: -1 }] - Optional sorting criteria.
 * @param {string | object} [select] - Optional fields selection.
 * @param {string | object} [populate] - Optional population options.
 * @returns {Promise<object>} - An object containing pagination data and results.
 */
async function paginate(
  model,
  query = {},
  page = 1,
  pageSize = 10,
  sort = { createdAt: -1 },
  select,
  populate
) {
  page = Math.max(1, parseInt(page, 10) || 1);
  pageSize = Math.max(1, parseInt(pageSize, 10) || 10);

  const skip = (page - 1) * pageSize;

  let findQuery = model.find(query).sort(sort).skip(skip).limit(pageSize);

  if (select) {
    findQuery = findQuery.select(select);
  }

  if (populate) {
    findQuery = findQuery.populate(populate);
  }

  const [data, totalDocs] = await Promise.all([
    findQuery.exec(),
    model.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalDocs / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;
  const nextPage = hasNextPage ? page + 1 : null;
  const prevPage = hasPrevPage ? page - 1 : null;

  return {
    data,
    pagination: {
      totalDocs,
      limit: pageSize,
      totalPages,
      currentPage: page,
      pagingCounter: skip + 1,
      hasPrevPage,
      hasNextPage,
      prevPage,
      nextPage,
    },
  };
}

function validateHeaders(expectedHeaders, actualHeaderRow = {}) {
  const actualHeaders = Object.keys(actualHeaderRow);
  if (expectedHeaders.length !== actualHeaders.length) {
    console.warn('Header length mismatch');
    return {
      status: false,
      message: 'CSV header count does not match expected count.',
    };
  }
  for (const header of expectedHeaders) {
    if (!Object.prototype.hasOwnProperty.call(actualHeaderRow, header)) {
      console.warn(`Missing header: ${header}`);
      return {
        status: false,
        message: `Missing required CSV header: ${header}. Please refer to the sample file.`,
      };
    }
  }
  return { status: true };
}

async function validateUsersCsvFile(csvData) {
  const validData = [];
  const invalidData = [];
  const seenEmails = new Set();
  // const seenEmployeeIDs = new Set();

  for (let i = 0; i < csvData.length; i++) {
    const row = csvData[i];
    const rowNumber = i + 2;
    const trimmedRow = {};
    for (const key in row) {
      // Trim strings
      trimmedRow[key] =
        typeof row[key] === 'string' ? row[key].trim() : row[key];
    }

    const { error, value } = bulkCreateUserRowSchema.validate(trimmedRow, {
      abortEarly: false,
    });

    if (error) {
      invalidData.push({
        '#': `Row ${rowNumber}`,
        Reason: error.details.map((d) => d.message).join(', '),
        ...row,
      });
      continue;
    }

    const email = value?.email?.toLowerCase();
    // const employeeId = value?.employeeId;

    if (seenEmails.has(email)) {
      invalidData.push({
        '#': `Row ${rowNumber}`,
        Reason: `Duplicate Email '${value.Email}' in CSV.`,
        ...row,
      });
      continue;
    }
    seenEmails.add(email);

    // if (employeeId && seenEmployeeIDs.has(employeeId)) {
    //   invalidData.push({
    //     '#': `Row ${rowNumber}`,
    //     Reason: `Duplicate EmployeeID '${employeeId}' in CSV.`,
    //     ...row,
    //   });
    //   continue;
    // }
    // if (employeeId) seenEmployeeIDs.add(employeeId);

    // Map to model fields (simplified)
    validData.push({
      firstName: value.firstName,
      lastName: value.lastName,
      email: value.email,
      password: value.password,
      // employeeId: value.employeeId || null,
      jobTitle: value.jobTitle || null,
      department: value.department || null,
      hireDate: value.hireDate || null,
      phoneNumber: value.phoneNumber || null,
      teamLeadId: value.teamLeadId || null,
      subTeamLeadId: value.subTeamLeadId || null,
      role: value.role,
      status: value.status,
    });
  }
  return { validData, invalidData };
}

function autoGenerateEmpId(lastUser) {
  let nextNumber = 1;
  if (lastUser?.employeeId) {
    const lastNumber = parseInt(lastUser?.employeeId?.split('_')[1], 10);
    nextNumber = isNaN(lastNumber) ? 1 : lastNumber + 1;
  }
  return nextNumber;
}

function formatDateToKolkata(dateStr) {
  const timeZone = 'Asia/Kolkata';
  const date = new Date(dateStr);
  return format(date, 'dd MMMM yyyy', { timeZone });
}

function generateCIFToken(email) {
  const token = jwt.sign({
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7),
    email: email,
  }, process.env.CIF_TOKEN_SECRET);
  return token;
}

async function validateCIFToken(token) {
  try {
    if (!token) throw new Error('Token is missing.');

    const payload = jwt.verify(token, process.env.CIF_TOKEN_SECRET);
    const email = payload.email;

    const candidate = await candidateModel.findOne({
      personalEmail: email,
      isDeleted: false,
      status: { $nin: ['backout','underReview','approved','submitted','resubmitted','completed'] }
    }).sort({ 
      status: 1, 
      createdAt: -1 
    });

    const user = candidate ? null : await User.findOne({ email: email, isDeleted: false, formStatus: { $ne: "submitted"} });

    if (!candidate && !user) {
      throw new Error('No matching user found.');
    }
    
    return { isValid: true, email };
  } catch (err) {
    console.error('Token validation failed:', err.message || err);
    return { isValid: false, message: 'Invalid or expired link.' };
  }
}

function cleanEmptyFields(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(cleanEmptyFields)
      .filter(item =>
        item !== undefined &&
        item !== null &&
        !(typeof item === 'string' && item.trim() === '') &&
        !(typeof item === 'object' && Object.keys(item).length === 0)
      );
  }

  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      const cleanedValue = cleanEmptyFields(value);
      if (
        cleanedValue !== undefined &&
        cleanedValue !== null &&
        !(typeof cleanedValue === 'string' && cleanedValue.trim() === '') &&
        !(typeof cleanedValue === 'object' && Object.keys(cleanedValue).length === 0)
      ) {
        acc[key] = cleanedValue;
      }
      return acc;
    }, {});
  }

  return obj;
}

const transformDocumentPaths = (documents) => {
  const baseUrl = process.env.IMAGE_BASE_URL;

  if (!documents || typeof documents !== 'object' || !baseUrl) {
    return documents || {};
  }

  const documentsWithUrls = {};

  for (const [key, relativePath] of Object.entries(documents)) {
    if (
      typeof relativePath === 'string' &&
      (
        relativePath.startsWith('http://') ||
        relativePath.startsWith('https://') ||
        relativePath.startsWith(baseUrl)
      )
    ) {
      // Already a full URL or starts with baseUrl, use as is
      documentsWithUrls[key] = relativePath;
    } else {
      // Only prepend baseUrl if it's a relative path
      documentsWithUrls[key] = `${baseUrl}/${relativePath}`;
    }
  }

  return documentsWithUrls;
};





module.exports = {
  paginate,
  validateHeaders,
  validateUsersCsvFile,
  autoGenerateEmpId,
  formatDateToKolkata,
  generateCIFToken,
  validateCIFToken,
  cleanEmptyFields,
  transformDocumentPaths,
};
