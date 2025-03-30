// src/utility/common.js
const mongoose = require('mongoose');

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
  // Ensure page and pageSize are positive integers
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

module.exports = { paginate };
