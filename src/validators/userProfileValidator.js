const Joi = require('joi');
const { candidateDraftSchema } = require('./candidateValidator');

const PROFILE_SECTION_MAP = {
  personalInfo: 'personalInfo',
  addressInfo: 'addressDetails',
  education: 'educationDetails',
  employmentHistory: 'employment',
  medicalInfo: 'medicalInfo',
  backgroundInfo: 'backgroundInfo',
  bankDetails: 'bankDetails',
  documents: 'documents',
};

const PROFILE_SECTION_LABELS = {
  personalInfo: 'Personal details',
  addressInfo: 'Address',
  education: 'Education',
  employmentHistory: 'Employment history',
  medicalInfo: 'Medical info',
  backgroundInfo: 'Background check',
  bankDetails: 'Bank details',
  documents: 'Documents',
};

// Profile PUT allows partial section updates (merge with existing CIF data).
const profileEducationSchema = Joi.object({
  tenth: Joi.object({
    institute: Joi.string().min(1).optional(),
    board: Joi.string().min(1).optional(),
    passoutYear: Joi.string().min(1).optional(),
  }).optional(),
  twelfth: Joi.object({
    institute: Joi.string().min(1).optional(),
    board: Joi.string().min(1).optional(),
    stream: Joi.string().min(1).optional(),
    passoutYear: Joi.string().min(1).optional(),
  }).optional(),
  graduation: Joi.object({
    institute: Joi.string().min(1).optional(),
    course: Joi.string().min(1).optional(),
    type: Joi.string().min(1).optional(),
    passoutYear: Joi.string().min(1).optional(),
  }).optional(),
  postGraduation: Joi.object({
    institute: Joi.string().allow('', null).optional(),
    course: Joi.string().allow('', null).optional(),
    type: Joi.string().allow('', null).optional(),
    passoutYear: Joi.string().allow('', null).optional(),
  }).optional(),
});

const PROFILE_SECTION_SCHEMAS = {
  education: profileEducationSchema,
};

async function validateProfileSection(routeKey, payload) {
  const fieldKey = PROFILE_SECTION_MAP[routeKey];
  if (!fieldKey) {
    throw new Error(`Invalid profile section: ${routeKey}`);
  }

  if (PROFILE_SECTION_SCHEMAS[routeKey]) {
    return PROFILE_SECTION_SCHEMAS[routeKey].validateAsync(payload, {
      stripUnknown: true,
    });
  }

  const validated = await candidateDraftSchema.validateAsync(
    { [fieldKey]: payload },
    { stripUnknown: true }
  );

  return validated[fieldKey];
}

module.exports = {
  PROFILE_SECTION_MAP,
  PROFILE_SECTION_LABELS,
  validateProfileSection,
};
