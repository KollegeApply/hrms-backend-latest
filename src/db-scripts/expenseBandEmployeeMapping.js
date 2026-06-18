/**
 * Expense band (K1–K4) by employeeId — from HR spreadsheet (May 2026).
 * Only K1–K3 are listed explicitly (~34 people); everyone else is K4.
 *
 * Update these arrays if the sheet changes, then re-run setExpenseBandsByEmployeeId.js
 */

/** @type {readonly string[]} */
const EXPENSE_BAND_K1 = [
  // KollegeApply
  'KAP_231',
  'KAP_130',
  'KAP_129',
  'KAP_019',
  'KAP_018',
  // SportsDunia
  'SD_001',
  'SD_149',
  'SD_005',
];

/** @type {readonly string[]} */
const EXPENSE_BAND_K2 = [
  'KAP_328',
  'KAP_237',
  'KAP_235',
  'KAP_223',
  'KAP_221',
  'KAP_220',
  'KAP_219',
  'KAP_217',
  'KAP_208',
  'KAP_128',
  'KAP_104',
  'KAP_017',
  'KAP_011',
  'KAP_010',
  'KAP_009',
  'KAP_005',
  'KAP_004',
  'KAP_002',
  'SD_173',
];

/** @type {readonly string[]} */
const EXPENSE_BAND_K3 = [
  'KAP_374',
  'KAP_228',
  'KAP_218',
  'KAP_016',
  'SD_146',
  'SD_010',
  'SD_002',
];

function normalizeEmployeeId(employeeId) {
  if (employeeId == null || employeeId === '') return '';
  return String(employeeId).trim().toUpperCase();
}

const _bandByCode = new Map();
for (const code of EXPENSE_BAND_K1) {
  _bandByCode.set(normalizeEmployeeId(code), 'K1');
}
for (const code of EXPENSE_BAND_K2) {
  _bandByCode.set(normalizeEmployeeId(code), 'K2');
}
for (const code of EXPENSE_BAND_K3) {
  _bandByCode.set(normalizeEmployeeId(code), 'K3');
}

/**
 * @param {string | null | undefined} employeeId
 * @returns {'K1' | 'K2' | 'K3' | 'K4'}
 */
function getExpenseBandForEmployeeId(employeeId) {
  const key = normalizeEmployeeId(employeeId);
  if (!key) return 'K4';
  return _bandByCode.get(key) || 'K4';
}

function validateMapping() {
  const seen = new Set();
  const all = [
    ...EXPENSE_BAND_K1.map((c) => ({ band: 'K1', code: c })),
    ...EXPENSE_BAND_K2.map((c) => ({ band: 'K2', code: c })),
    ...EXPENSE_BAND_K3.map((c) => ({ band: 'K3', code: c })),
  ];
  for (const { band, code } of all) {
    const key = normalizeEmployeeId(code);
    if (seen.has(key)) {
      throw new Error(`Duplicate employeeId in mapping: ${code}`);
    }
    seen.add(key);
  }
  return {
    k1: EXPENSE_BAND_K1.length,
    k2: EXPENSE_BAND_K2.length,
    k3: EXPENSE_BAND_K3.length,
    totalNonK4: seen.size,
  };
}

module.exports = {
  EXPENSE_BAND_K1,
  EXPENSE_BAND_K2,
  EXPENSE_BAND_K3,
  normalizeEmployeeId,
  getExpenseBandForEmployeeId,
  validateMapping,
};
