/**
 * KollegeHR Expense Module — Phase 2 policy enums & caps (PRD May 2026).
 */

const EXPENSE_TYPES = {
  TRAVEL: 'Travel',
  FOOD: 'Food',
  MISCELLANEOUS: 'Miscellaneous',
  MOBILE_BILL: 'Mobile Bill',
  TECHNICAL_TOOLS: 'Technical Tools',
  TEAM_LUNCH: 'Team Lunch',
};

/** Types allowed on new submissions (Stay removed per Phase 2). */
const EXPENSE_TYPES_CREATE = [
  EXPENSE_TYPES.TRAVEL,
  EXPENSE_TYPES.FOOD,
  EXPENSE_TYPES.MISCELLANEOUS,
  EXPENSE_TYPES.MOBILE_BILL,
  EXPENSE_TYPES.TECHNICAL_TOOLS,
  EXPENSE_TYPES.TEAM_LUNCH,
];

const TRAVEL_SUBCATEGORIES = [
  '2 Wheeler',
  '4 Wheeler',
  'Metro',
  'Auto',
  'Bus',
  'Bike',
  'Train',
  'Toll',
  'Misc',
];

const FOOD_SUBCATEGORIES = ['Metro', 'Non-Metro'];

const MISCELLANEOUS_SUBCATEGORIES = [
  'Hotel Accommodation',
  'Flight',
  'Client Gifting',
  'Client Lunch',
  'Others',
];

const TEAM_LUNCH_PER_ATTENDEE = 1500;
const MOBILE_BILL_FIXED_AMOUNT = 2000;
const ATTACHMENT_THRESHOLD_AMOUNT = 150;

/** Food — daily cap by band & metro flag (PRD §7 table). */
const FOOD_DAILY_CAP = {
  K1: { metro: 1200, nonMetro: 1000 },
  K2: { metro: 1000, nonMetro: 900 },
  K3: { metro: 900, nonMetro: 800 },
  K4: { metro: 800, nonMetro: 700 },
};

/** Hotel Accommodation — per night excl. GST (PRD). */
const HOTEL_PER_NIGHT_CAP = {
  K1: { metro: 3500, nonMetro: 3000 },
  K2: { metro: 3000, nonMetro: 2500 },
  K3: { metro: 2500, nonMetro: 1800 },
  K4: { metro: 1800, nonMetro: 1500 },
};

/** Per-km reimbursement (PRD). K4 always uses 2W rate. */
function travelPerKmRate(subCategory, band) {
  if (subCategory === '2 Wheeler') return 7;
  if (subCategory === '4 Wheeler') return band === 'K4' ? 7 : 12;
  return null;
}

/** Phase 2 placeholder until admin policy UI stores overrides. */
const TECHNICAL_TOOLS_DEFAULTS = {
  maxPerTransaction: 25000,
  maxPerCalendarMonth: 50000,
};

const TL_ROLES_FOR_TEAM_LUNCH = ['teamlead', 'subteamlead'];

module.exports = {
  EXPENSE_TYPES,
  EXPENSE_TYPES_CREATE,
  TRAVEL_SUBCATEGORIES,
  FOOD_SUBCATEGORIES,
  MISCELLANEOUS_SUBCATEGORIES,
  TEAM_LUNCH_PER_ATTENDEE,
  MOBILE_BILL_FIXED_AMOUNT,
  ATTACHMENT_THRESHOLD_AMOUNT,
  FOOD_DAILY_CAP,
  HOTEL_PER_NIGHT_CAP,
  travelPerKmRate,
  TECHNICAL_TOOLS_DEFAULTS,
  TL_ROLES_FOR_TEAM_LUNCH,
};
