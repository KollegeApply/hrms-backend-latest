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
  'Cab',
  'Metro',
  'Auto',
  'Bus',
  'Bike',
  'Train',
  'Toll',
  'Parking',
  'Misc',
];

/**
 * Travel Policy (Nov 2026) — role-wise category. Expense bands map to it:
 * K1 = Zonal Head, K2 = Team Leader, K3/K4 = Account Manager.
 */
const EXPENSE_ROLE_CATEGORY = {
  K1: 'Zonal Head',
  K2: 'Team Leader',
  K3: 'Account Manager',
  K4: 'Account Manager',
};

/**
 * Intracity (base location) modes an Account Manager may NOT claim
 * (policy: AM = Bus, Auto, Metro and personal 2-wheeler only).
 */
const AM_DISALLOWED_INTRACITY_SUBCATEGORIES = ['Cab'];

const FOOD_SUBCATEGORIES = ['Metro', 'Non-Metro'];

const MISCELLANEOUS_SUBCATEGORIES = [
  'Hotel Accommodation',
  'Flight',
  'Client Gifting',
  'Client Lunch',
  'Others',
];

const TEAM_LUNCH_PER_ATTENDEE = 1500;
const MOBILE_BILL_FIXED_AMOUNT = 500;
const ATTACHMENT_THRESHOLD_AMOUNT = 150;

/** Travel > Trip Context — exactly two allowed values. */
const TRIP_CONTEXTS = {
  BASE_LOCATION: 'Base location (Intracity)',
  OUTSTATION: 'Outstation (Intercity)',
};

const TRIP_CONTEXT_VALUES = [
  TRIP_CONTEXTS.BASE_LOCATION,
  TRIP_CONTEXTS.OUTSTATION,
];

/** Base location (Intracity) Travel — per-meeting cap by band (Policy: ZH 500 / TL 400 / AM 250). */
const BASE_LOCATION_TRAVEL_PER_MEETING_CAP = {
  K1: 500,
  K2: 400,
  K3: 250,
  K4: 250,
};

/** Base location (Intracity) Travel — monthly cap per person, all-inclusive (Policy). */
const BASE_LOCATION_TRAVEL_MONTHLY_CAP = 10000;

/**
 * Out-of-station add-on, released over and above the 10,000 only when the
 * month's out-of-station travel mandate is completed in full. It covers the
 * local commute (hotel -> client -> hotel) in an outstation city only.
 * AM = 4,000 (ceiling 14,000); TL & ZH = 6,000 (ceiling 16,000).
 */
const OUTSTATION_LOCAL_ADDON_CAP = {
  K1: 6000,
  K2: 6000,
  K3: 4000,
  K4: 4000,
};

/** Travel sub-categories that make up the outstation local commute. */
const OUTSTATION_LOCAL_COMMUTE_SUBCATEGORIES = [
  '2 Wheeler',
  '4 Wheeler',
  'Cab',
  'Metro',
  'Auto',
  'Bus',
  'Bike',
  'Toll',
  'Parking',
];

/** Mandate: 2 evidenced client meetings per day. */
const MEETINGS_PER_DAY_MANDATE = 2;

/** Trip origin (Policy: only Office -> Client -> Office is reimbursable). */
const TRIP_ORIGINS = {
  OFFICE: 'Office',
  OTHER: 'Other',
};
const TRIP_ORIGIN_VALUES = [TRIP_ORIGINS.OFFICE, TRIP_ORIGINS.OTHER];

/**
 * A meeting is claimed as both legs by the same person — Office -> Client
 * (Outbound) and Client -> Office (Return) — each its own line.
 */
const TRIP_LEGS = { OUTBOUND: 'Outbound', RETURN: 'Return' };
const TRIP_LEG_VALUES = [TRIP_LEGS.OUTBOUND, TRIP_LEGS.RETURN];

/**
 * Submission window (Policy): previous month's claims are filed by the 2nd
 * of the month at 5:00 PM (IST); nothing from an earlier month is accepted.
 */
const EXPENSE_SUBMISSION_DEADLINE_DAY = 2;
const EXPENSE_SUBMISSION_DEADLINE_HOUR_IST = 17;

/** Food — daily cap by band & metro flag (PRD §7 table). */
const FOOD_DAILY_CAP = {
  K1: { metro: 800, nonMetro: 600 },
  K2: { metro: 600, nonMetro: 400 },
  K3: { metro: 400, nonMetro: 300 },
  K4: { metro: 400, nonMetro: 300 },
};

/** Hotel Accommodation — per night excl. GST (PRD). */
const HOTEL_PER_NIGHT_CAP = {
  K1: { metro: 3500, nonMetro: 3000 },
  K2: { metro: 3000, nonMetro: 2500 },
  K3: { metro: 1800, nonMetro: 1800 },
  K4: { metro: 1800, nonMetro: 1800 },
};

/** Per-km reimbursement (Policy). Account Managers (K3/K4) always get the 2W rate. */
function travelPerKmRate(subCategory, band) {
  if (subCategory === '2 Wheeler') return 7;
  if (subCategory === '4 Wheeler') return band === 'K3' || band === 'K4' ? 7 : 12;
  return null;
}

/** Phase 2 placeholder until admin policy UI stores overrides. */
const TECHNICAL_TOOLS_DEFAULTS = {
  maxPerTransaction: 25000,
  maxPerCalendarMonth: 50000,
};

const TL_ROLES_FOR_TEAM_LUNCH = ['teamlead', 'subteamlead'];

/**
 * Per-user monthly spend budget — Travel and Food only. Purely
 * informational: the Add Expense form meters the month's running total
 * (Travel + Food claims) against it, and going over is allowed (the meter
 * just turns red). Every other expense type (Stay, Miscellaneous, Mobile
 * Bill, Technical Tools, Team Lunch) never counts toward it.
 */
const MONTHLY_EXPENSE_BUDGET = 10000;
const MONTHLY_EXPENSE_BUDGET_TYPES = ['Travel', 'Food'];

/**
 * Policy caps inform the claimant, they never block submission. Every expense
 * is stamped with one of these two tags at create/resubmit time so approvers
 * can see — and filter by — which claims broke a cap.
 */
const EXPENSE_POLICY_TAGS = {
  IN_POLICY: 'in-policy',
  OUT_OF_POLICY: 'out-of-policy',
};

const EXPENSE_POLICY_TAG_VALUES = [
  EXPENSE_POLICY_TAGS.IN_POLICY,
  EXPENSE_POLICY_TAGS.OUT_OF_POLICY,
];

/** FR-1.1/1.2 — shown to a blocked employee when Admin hasn't set a custom message. */
const DEFAULT_EXPENSE_FILING_CUTOFF_MESSAGE =
  'Expense filing is currently closed. Please contact Admin for more information.';

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
  TRIP_CONTEXTS,
  TRIP_CONTEXT_VALUES,
  BASE_LOCATION_TRAVEL_PER_MEETING_CAP,
  BASE_LOCATION_TRAVEL_MONTHLY_CAP,
  OUTSTATION_LOCAL_ADDON_CAP,
  OUTSTATION_LOCAL_COMMUTE_SUBCATEGORIES,
  EXPENSE_ROLE_CATEGORY,
  AM_DISALLOWED_INTRACITY_SUBCATEGORIES,
  MEETINGS_PER_DAY_MANDATE,
  TRIP_ORIGINS,
  TRIP_ORIGIN_VALUES,
  TRIP_LEGS,
  TRIP_LEG_VALUES,
  EXPENSE_SUBMISSION_DEADLINE_DAY,
  EXPENSE_SUBMISSION_DEADLINE_HOUR_IST,
  DEFAULT_EXPENSE_FILING_CUTOFF_MESSAGE,
  EXPENSE_POLICY_TAGS,
  EXPENSE_POLICY_TAG_VALUES,
  MONTHLY_EXPENSE_BUDGET,
  MONTHLY_EXPENSE_BUDGET_TYPES,
};
