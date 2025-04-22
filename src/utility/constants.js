const USER_ROLES = {
  ADMIN: 'admin',
  HR: 'hr',
  EMPLOYEE: 'employee',
  CONTRACTOR: 'contractor',
  TEAMLEAD: 'teamlead',
  SUBTEAMLEAD: 'subteamlead',
};

const EMPLOYEE_STATUS = {
  PROBATION: 'probation',
  TERMINATED: 'terminated',
  ABSCONDED: 'absconded',
  ONROLL: 'onroll',
};

const MAIL_HOST = 'smtp.gmail.com';
const MAIL_PORT = 465;
const MAIL_SECURE = true;
const MAIL_SERVICE = 'gmail';

// Derive from environment variables if set, otherwise use defaults
const MAIL_FROM = process.env.SMTP_FROM_EMAIL || 'noreply@yourcompany.com';
const MAIL_USER = process.env.SMTP_USER;
const MAIL_PASS = process.env.SMTP_PASS;
const HR_EMAIL = 'fakeofake404@gmail.com';

const OTP_EXPIRY_MINUTES = 10;

const USER_CSV_FILE_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'password', // Important: Ensure secure handling/generation if needed
  'employeeId',
  'jobTitle',
  'department', // Assuming you upload the Department's MongoDB ObjectId
  'hireDate', // Expected format: YYYY-MM-DD
  'phoneNumber',
  'teamLeadId', // Required: User's MongoDB ObjectId
  'subTeamLeadId', // Optional: User's MongoDB ObjectId
  'role', // Must match values in VALID_USER_ROLES
  'status', // Must match values in VALID_EMPLOYEE_STATUS
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

module.exports = {
  USER_ROLES,
  EMPLOYEE_STATUS,
  VALID_USER_ROLES: Object.values(USER_ROLES),
  VALID_EMPLOYEE_STATUS: Object.values(EMPLOYEE_STATUS),
  MAIL_HOST,
  MAIL_PORT,
  MAIL_SECURE,
  MAIL_SERVICE,
  MAIL_FROM,
  MAIL_USER,
  MAIL_PASS,
  OTP_EXPIRY_MINUTES,
  HR_EMAIL,
  USER_CSV_FILE_HEADERS,
  CSV_TYPES,
};
