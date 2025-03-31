const USER_ROLES = {
  ADMIN: 'admin',
  HR: 'hr',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
};

const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PROBATION: 'probation',
  TERMINATED: 'terminated',
  ON_LEAVE: 'on_leave',
};

const MAIL_HOST = 'smtp.gmail.com';
const MAIL_PORT = 465;
const MAIL_SECURE = true;
const MAIL_SERVICE = 'gmail';

// Derive from environment variables if set, otherwise use defaults
const MAIL_FROM = process.env.SMTP_FROM_EMAIL || 'noreply@yourcompany.com';
const MAIL_USER = process.env.SMTP_USER;
const MAIL_PASS = process.env.SMTP_PASS;

const OTP_EXPIRY_MINUTES = 10;

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
};
