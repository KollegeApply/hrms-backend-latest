const express = require('express');
const {
  authenticateUser,
  authorizeRole,
} = require('../middleware/authMiddleware');
const assetController = require('../controllers/assetController');
const { USER_ROLES } = require('../utility/constants');

const router = express.Router();

// Route to assign an asset to an employee
router.post(
  '/assign-asset',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.assignAsset
);

// Inventory: create asset (master) — admin only
router.post(
  '/inventory',
  authenticateUser,
  authorizeRole([USER_ROLES?.IT]),
  assetController.createAssetInventory
);

// Inventory: list assets (table)
router.get(
  '/inventory',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
    USER_ROLES?.TEAMLEAD,
    USER_ROLES?.SUBTEAMLEAD,
  ]),
  assetController.listAssetInventory
);

router.get(
  '/asset-summary',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.getPCDepartmentSummary,
);

// Route to fetch all assigned assets
router.get(
  '/assigned',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
    USER_ROLES?.TEAMLEAD,
    USER_ROLES?.SUBTEAMLEAD,
  ]),
  assetController.fetchAssignedAssets
);

//Route to fetch assigned asset by user ID
router.get(
  '/assigned-assets-for-user',
  authenticateUser,
  assetController.fetchAssignedAssetByUserId
);

// Route to update the assigned asset
router.put(
  '/update-assigned-asset/:id',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.updateAssignedAsset
);

router.put(
  '/acknowledge-asset/:id',
  authenticateUser,
  assetController.acknowledgeAsset
);

router.put('/reject-asset/:id', authenticateUser, assetController.rejectAsset);

router.put('/return-asset/:id', authenticateUser, assetController.returnAsset);

router.get(
  '/requests',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.fetchAssetRequests
);
// Updated route to handle approval/rejection of requests
router.put(
  '/requests/:id',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.handleAssetRequestUpdate
);

// Route to create asset request
router.post(
  '/request',
  authenticateUser,
  assetController.createAssetRequest
);

// Route to fetch all asset requests (for HR/IT/Admin)
router.get(
  '/requests-list',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.fetchAssetRequestsList
);

// Route to fetch asset requests by user ID
router.get(
  '/my-requests',
  authenticateUser,
  assetController.fetchAssetRequestsByUserId
);

// Route to fetch team assets (for Team Lead, Sub Team Lead, HR, Admin, Subadmin)
router.get(
  '/team-assets',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.TEAMLEAD,
    USER_ROLES?.SUBTEAMLEAD,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.fetchTeamAssets
);

// Route to update return request status
router.put(
  '/return-requests/:id',
  authenticateUser,
  authorizeRole([
    USER_ROLES?.IT,
    USER_ROLES?.HR,
    USER_ROLES?.SUBADMIN,
    USER_ROLES?.ADMIN,
  ]),
  assetController.updateAssetRequestStatus
);

module.exports = router;
