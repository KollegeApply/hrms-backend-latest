const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.development') });

const USER_ROLES = {
  ADMIN: 'admin',
  SUBADMIN: 'subadmin',
  HR: 'hr',
  EMPLOYEE: 'employee',
  INTERN: 'intern',
  TEAMLEAD: 'teamlead',
  SUBTEAMLEAD: 'subteamlead',
  IT: 'IT',
};

/** Expense policy band (K1–K4 only). */
const EXPENSE_BANDS = {
  K1: 'K1',
  K2: 'K2',
  K3: 'K3',
  K4: 'K4',
};

const EMPLOYEE_STATUS = {
  PROBATION: 'probation',
  TERMINATED: 'terminated',
  ABSCONDED: 'absconded',
  ONROLL: 'onroll',
  RESIGNED: 'resigned',
};

const LEAVETYPES = {
  casualSickLeave: 'Casual or Sick Leave',
  annualLeave: 'Annual Leave',
  bereavementLeaves: 'Bereavement Leave',
  marriageLeave: 'Marriage Leave',
  birthdayLeave: 'Birthday Leave',
};

const ASSETS_STATUS = {
  ASSIGNED: 'assigned',
  ACKNOWLEDGED: 'acknowledged',
  NOT_ACKNOWLEDGED: 'not_acknowledged',
  RETURN_REQUESTED: 'return_requested',
  RETURN_APPROVED: 'return_approved',
  RETURN_REJECTED: 'return_rejected',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
};

const ASSET_REQUEST_STATUS = {
  PENDING: 'asset-request-pending',
  APPROVED: 'asset-request-approved',
  REJECTED: 'asset-request-rejected',
  FULFILLED: 'asset-request-fulfilled',
};


const CANDIDATE_STATUS = {
  PENDING: 'pending',
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  RESENT: 'resent',
  REDRAFT: 'redraft',
  RESUBMITTED: 'resubmitted',
  UNDER_REVIEW: 'underReview',
  APPROVED: 'approved',
  COMPLETED: 'completed',
  BACKOUT: 'backout'
};

const LAPTOP_TYPES = {
  MACOS: 'macos',
  WINDOWS: 'windows',
}

const ASSET_ASSIGNMENT_TYPES = {
  TEMPORARY: 'temporary',
  PERMANENT: 'permanent',
};

const ASSET_CONDITIONS = {
  NEW: 'new',
  GOOD: 'good',
  FAIR: 'fair',
  NEEDS_REPAIR: 'needs_repair',
};

const ASSET_INVENTORY_STATUS = {
  AVAILABLE: 'available',
  ASSIGNED: 'assigned',
  UNDER_REPAIR: 'under_repair',
  RETURNED_TO_VENDOR: 'returned_to_vendor',
};

/** Create form / admin create: only these three. `assigned` is set by system on assign. */
const VALID_ASSET_INVENTORY_CREATE_STATUS = [
  ASSET_INVENTORY_STATUS.AVAILABLE,
  ASSET_INVENTORY_STATUS.UNDER_REPAIR,
  ASSET_INVENTORY_STATUS.RETURNED_TO_VENDOR,
];


const MAIL_HOST = 'smtp.gmail.com';
const MAIL_PORT = 465;
const MAIL_SECURE = true;
const MAIL_SERVICE = 'gmail';

// Derive from environment variables if set, otherwise use defaults
const MAIL_FROM_HR =
  process.env.SMTP_FROM_EMAIL_HR || 'noreply@yourcompany.com';
const MAIL_FROM_SUPPORT =
  process.env.SMTP_FROM_EMAIL_SUPPORT || 'noreply@yourcompany.com';
const MAIL_FROM_IT =
  process.env.SMTP_FROM_EMAIL_IT || 'noreply@yourcompany.com';
const MAIL_USER = process.env.SMTP_USER;
const MAIL_PASS = process.env.SMTP_PASS;
const HR_EMAIL = process.env.HR_EMAIL;
const HR_MAIL_USER = process.env.HR_SMTP_USER;
const HR_MAIL_PASS = process.env.HR_SMTP_PASS;
const IT_EMAIL = process.env.IT_EMAIL;
const IT_MAIL_USER = process.env.IT_SMTP_USER;
const IT_MAIL_PASS = process.env.IT_SMTP_PASS;
const HRMS_QUERY_EMAIL = process.env.HRMS_QUERY_EMAIL;

const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim()).filter(Boolean) || [];


const TEAM_SD = process.env.TEAM_SD;
const TEAM_KAP = process.env.TEAM_KAP;

function getTeamEmailConfig(team) {
  const normalizedTeam = team?.toUpperCase();
  const config = {
    TEAM_NAME: process.env[`TEAM_${normalizedTeam}`],

    MAIL_FROM_HR: process.env[`SMTP_FROM_EMAIL_HR_${normalizedTeam}`],
    MAIL_FROM_SUPPORT: process.env[`SMTP_FROM_EMAIL_SUPPORT_${normalizedTeam}`],
    MAIL_FROM_IT: process.env[`SMTP_FROM_EMAIL_IT_${normalizedTeam}`],

    MAIL_USER: process.env[`SMTP_USER_${normalizedTeam}`],
    MAIL_PASS: process.env[`SMTP_PASS_${normalizedTeam}`],

    HR_EMAIL: process.env[`HR_EMAIL_${normalizedTeam}`],
    HR_MAIL_USER: process.env[`HR_SMTP_USER_${normalizedTeam}`],
    HR_MAIL_PASS: process.env[`HR_SMTP_PASS_${normalizedTeam}`],

    IT_EMAIL: process.env[`IT_EMAIL_${normalizedTeam}`],
    IT_MAIL_USER: process.env[`IT_SMTP_USER_${normalizedTeam}`],
    IT_MAIL_PASS: process.env[`IT_SMTP_PASS_${normalizedTeam}`],

    FINANCE_EMAIL: process.env[`FINANCE_EMAIL_${normalizedTeam}`],

    HRMS_QUERY_EMAIL: process.env[`HRMS_QUERY_EMAIL`],

    ADMIN_EMAILS: (process.env[`ADMIN_EMAILS_${normalizedTeam}`] || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean),

      GROUP_EMAILS: (process.env[`GROUP_EMAILS_${normalizedTeam}`] || '')
      .split(',')
      .map(e => e.trim())
      .filter(Boolean),
  };

  const requiredKeys = [
    'HR_EMAIL',
    'IT_EMAIL',
    'MAIL_USER',
    'MAIL_PASS',
    'HR_MAIL_USER',
    'HR_MAIL_PASS',
    'IT_MAIL_USER',
    'IT_MAIL_PASS',
    'HRMS_QUERY_EMAIL',
  ];

  const missing = requiredKeys.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(
      `Missing required email config values for team ${team}: ${missing.join(', ')}`
    );
  }

  return config;
}


const OTP_EXPIRY_MINUTES = 10;

const RANK = {
  admin: 1,
  subadmin: 2,
  hr: 3,
  teamlead: 4,
  subteamlead: 5,
  employee: 6,
};

const USER_CSV_FILE_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'password',
  'jobTitle',
  'department',
  'hireDate',
  'phoneNumber',
  'teamLeadId',
  'subTeamLeadId',
  'role',
  'status',
  // Optional Address Fields
  // 'AddressStreet',
  // 'AddressCity',
  // 'AddressState',
  // 'AddressZipCode',
  // 'AddressCountry',
];

const CSV_TYPES = [
  'text/csv',
  'application/vnd.ms-excel', // Common MIME type for CSV
  'application/csv',
];

const SYSTEM_LAUNCH_YEAR = 2025;
const SYSTEM_START_MONTH = 4;

module.exports = {
  USER_ROLES,
  EXPENSE_BANDS,
  VALID_EXPENSE_BANDS: Object.values(EXPENSE_BANDS),
  EMPLOYEE_STATUS,
  VALID_USER_ROLES: Object.values(USER_ROLES),
  VALID_EMPLOYEE_STATUS: Object.values(EMPLOYEE_STATUS),
  VALID_ASSETS_STATUS: Object.values(ASSETS_STATUS),

  VALID_ASSET_REQUEST_STATUS: Object.values(ASSET_REQUEST_STATUS),
  VALID_LAPTOP_TYPES: Object.values(LAPTOP_TYPES),
  VALID_ASSET_ASSIGNMENT_TYPES: Object.values(ASSET_ASSIGNMENT_TYPES),
  VALID_ASSET_CONDITIONS: Object.values(ASSET_CONDITIONS),
  VALID_ASSET_INVENTORY_STATUS: Object.values(ASSET_INVENTORY_STATUS),
  VALID_ASSET_INVENTORY_CREATE_STATUS,
  CANDIDATE_STATUS,
  VALID_CANDIDATE_STATUS: Object.values(CANDIDATE_STATUS),
  MAIL_HOST,
  MAIL_PORT,
  MAIL_SECURE,
  MAIL_SERVICE,
  MAIL_FROM_HR,
  MAIL_FROM_SUPPORT,
  MAIL_FROM_IT,
  MAIL_USER,
  MAIL_PASS,
  HR_MAIL_USER,
  HR_MAIL_PASS,
  IT_MAIL_USER,
  IT_MAIL_PASS,
  HRMS_QUERY_EMAIL,
  OTP_EXPIRY_MINUTES,
  HR_EMAIL,
  IT_EMAIL,
  ADMIN_EMAILS,
  TEAM_SD,
  TEAM_KAP,
  USER_CSV_FILE_HEADERS,
  CSV_TYPES,
  RANK,
  LEAVETYPES,
  SYSTEM_LAUNCH_YEAR,
  SYSTEM_START_MONTH,
  getTeamEmailConfig,
  ASSET_ASSIGNMENT_TYPES,
  ASSET_CONDITIONS,
  ASSET_INVENTORY_STATUS,
};
