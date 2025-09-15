const { MongoClient } = require('mongodb');
require('dotenv').config({ path: './.env.production' });

const LAPTOP_TYPES = {
  MACOS: 'macos',
  WINDOWS: 'windows',
};

const uri = process.env.MONGO_URI;

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    const assetResult = await db.collection('assets').updateMany(
      {
        assetType: 'laptop',
        assetName: { $exists: true },
        laptopType: { $exists: false },
      },
      [
        {
          $set: {
            laptopType: {
              $cond: [
                { $regexMatch: { input: "$assetName", regex: /macbook|mac/i } },
                LAPTOP_TYPES.MACOS,
                {
                  $cond: [
                    { $regexMatch: { input: "$assetName", regex: /windows/i } },
                    LAPTOP_TYPES.WINDOWS,
                    null
                  ]
                }
              ]
            }
          }
        }
      ]
    );
    console.log(`Assets updated: ${assetResult.modifiedCount}`);

    const leaveResult = await db.collection('leaveapplications').updateMany(
      { status: "pending" },
      { $set: { status: "tl-pending" } }
    );
    console.log(`Leave applications updated: ${leaveResult.modifiedCount}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.close();
  }
}

run();