/**
 * Migrates legacy assignment documents (assets collection) that have no
 * inventoryAsset into assetinventories — one row per unique serialNumber
 * (trimmed). Duplicate serials across multiple assignments share one inventory.
 *
 * Usage (from repo root):
 *   NODE_ENV=development node scripts/migrateLegacyAssetsToInventory.js
 *   MIGRATION_DRY_RUN=true NODE_ENV=development node scripts/migrateLegacyAssetsToInventory.js
 *
 * Requires MONGO_URI in .env.<NODE_ENV> (or .env).
 */

const path = require('path');
const mongoose = require('mongoose');

if (process.env.NODE_ENV) {
  require('dotenv').config({ path: path.resolve(__dirname, `../.env.${process.env.NODE_ENV}`) });
} else {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

const Assets = require('../src/models/assetsModel');
const AssetInventory = require('../src/models/assetInventoryModel');
const Counter = require('../src/models/counterModel');
const { VALID_LAPTOP_TYPES } = require('../src/utility/constants');

const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true' || process.env.MIGRATION_DRY_RUN === '1';

const COUNTER_KEY = 'asset_inventory_ast';

function formatAssetId(seq) {
  return `AST${String(seq).padStart(3, '0')}`;
}

async function getNextAssetId() {
  const counter = await Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return formatAssetId(counter.seq);
}

function normalizeSerial(sn) {
  if (sn === undefined || sn === null) return '';
  return String(sn).trim();
}

function specsToString(spec) {
  if (spec === undefined || spec === null) return '';
  if (typeof spec === 'string') return spec.trim();
  try {
    return JSON.stringify(spec);
  } catch {
    return String(spec);
  }
}

function normalizeAssetType(raw) {
  if (!raw || !String(raw).trim()) return 'other';
  return String(raw).trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Inventory has only: available | assigned | under_repair | returned_to_vendor.
 * Legacy assignment workflow (acknowledged, not_acknowledged, return_*, etc.)
 * maps to inventory `assigned` while the item is with an employee.
 */
function mapAssignmentStatusToInventory(status) {
  const s = status || '';
  if (s === 'returned' || s === 'cancelled') return { inventoryStatus: 'available', assignedTo: null };
  return { inventoryStatus: 'assigned', assignedTo: 'fromDoc' };
}

/**
 * Pick which legacy assignment defines the NEW inventory row’s fields (name, type, etc.).
 * Prefer a non-returned/cancelled row so metadata matches an “active” assignment when both exist.
 * All docs in the group still receive inventoryAsset — this does not skip linking for history.
 */
function pickCanonicalAssignment(docs) {
  const terminal = new Set(['returned', 'cancelled']);
  const active = docs.filter((d) => !terminal.has(d.status));
  const pool = active.length ? active : docs;
  return pool.sort((a, b) => {
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return tb - ta;
  })[0];
}

function laptopTypeForInventory(normalizedType, laptopTypeFromDoc) {
  const v = laptopTypeFromDoc && String(laptopTypeFromDoc).trim();
  if (normalizedType !== 'laptop') return undefined;
  if (v && VALID_LAPTOP_TYPES.includes(v)) return v;
  return VALID_LAPTOP_TYPES[0] || 'windows';
}

async function syncCounterToMaxAssetId() {
  const invs = await AssetInventory.find({}).select('assetId').lean();
  let maxSeq = 0;
  for (const inv of invs) {
    const m = /^AST(\d+)$/i.exec(inv.assetId || '');
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  const counter = await Counter.findOne({ key: COUNTER_KEY }).lean();
  const current = counter?.seq || 0;
  const nextSeq = Math.max(current, maxSeq);
  if (DRY_RUN) {
    console.log(`[dry-run] Would sync counter ${COUNTER_KEY} seq to >= ${nextSeq} (max AST from DB: ${maxSeq})`);
    return;
  }
  await Counter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $set: { seq: nextSeq } },
    { upsert: true, new: true }
  );
  console.log(`Counter ${COUNTER_KEY} synced to seq=${nextSeq}`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Check your .env file.');
    process.exit(1);
  }

  console.log(DRY_RUN ? '*** DRY RUN (no writes) ***' : '*** LIVE RUN ***');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const legacyFilter = {
    $or: [{ inventoryAsset: { $exists: false } }, { inventoryAsset: null }],
  };

  const legacy = await Assets.find(legacyFilter).lean();
  const withSerial = legacy.filter((d) => normalizeSerial(d.serialNumber).length > 0);
  const skippedNoSerial = legacy.length - withSerial.length;

  const bySerial = new Map();
  for (const doc of withSerial) {
    const key = normalizeSerial(doc.serialNumber);
    if (!bySerial.has(key)) bySerial.set(key, []);
    bySerial.get(key).push(doc);
  }

  let linkedExisting = 0;
  let createdInventory = 0;
  let updatedAssignments = 0;
  const errors = [];

  for (const [serialKey, group] of bySerial) {
    try {
      let inventory = await AssetInventory.findOne({
        serialNumber: serialKey,
        isDeleted: false,
      }).lean();

      if (!inventory) {
        const canonical = pickCanonicalAssignment(group);
        const normType = normalizeAssetType(canonical.assetType);
        const { inventoryStatus, assignedTo: assignRule } = mapAssignmentStatusToInventory(
          canonical.status
        );
        const assignedTo =
          assignRule === 'fromDoc' && canonical.assignee ? canonical.assignee : null;

        const payload = {
          assetType: normType,
          laptopType: laptopTypeForInventory(normType, canonical.laptopType),
          assetName: (canonical.assetName && String(canonical.assetName).trim()) || 'Migrated asset',
          brand: 'Unknown',
          model: '',
          serialNumber: serialKey,
          condition: 'good',
          specifications: specsToString(canonical.specifications),
          status: inventoryStatus,
          assignedTo,
          notes: `Migrated from legacy assets assignments (${group.length} row(s) same serial).`,
          isDeleted: false,
        };

        if (DRY_RUN) {
          console.log(`[dry-run] Would create inventory for serial=${serialKey} (${group.length} assignments)`);
          createdInventory += 1;
        } else {
          const assetId = await getNextAssetId();
          const doc = await AssetInventory.create({ ...payload, assetId });
          inventory = doc.toObject();
          createdInventory += 1;
          console.log(`Created inventory ${assetId} for serial=${serialKey}`);
        }
      } else {
        linkedExisting += 1;
        console.log(`Serial ${serialKey} already in assetinventories — linking assignments only`);
      }

      const invId = inventory?._id;
      if (!DRY_RUN && invId) {
        // Link every legacy assignment for this serial (assigned, returned, cancelled, …) for history / joins.
        const ids = group.map((g) => g._id);
        const res = await Assets.updateMany(
          { _id: { $in: ids }, $or: [{ inventoryAsset: { $exists: false } }, { inventoryAsset: null }] },
          { $set: { inventoryAsset: invId } }
        );
        updatedAssignments += res.modifiedCount || 0;
      } else if (DRY_RUN && inventory) {
        console.log(`[dry-run] Would link ${group.length} assignment(s) to inventory _id=${inventory._id}`);
      }
    } catch (e) {
      errors.push({ serial: serialKey, message: e.message });
      console.error(`Error for serial ${serialKey}:`, e.message);
    }
  }

  await syncCounterToMaxAssetId();

  console.log('\n--- Summary ---');
  console.log(`Legacy assignments without inventory link (total fetched): ${legacy.length}`);
  console.log(`Skipped (no / empty serialNumber): ${skippedNoSerial}`);
  console.log(`Unique serial groups processed: ${bySerial.size}`);
  console.log(`Inventory rows created: ${createdInventory}`);
  console.log(`Serials that already had inventory: ${linkedExisting}`);
  console.log(`Assignment documents updated with inventoryAsset: ${updatedAssignments}`);
  if (errors.length) console.log(`Errors: ${errors.length}`, errors);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
