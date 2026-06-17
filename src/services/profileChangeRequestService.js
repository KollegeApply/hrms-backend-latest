const { default: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../utility/ApiError');
const ProfileChangeRequest = require('../models/profileChangeRequestModel');
const User = require('../models/userModel');
const UserDetails = require('../models/userDetailsModel');
const { transformDocumentPaths } = require('../utility/common');
const logger = require('../config/logger');
const profileChangeEmailService = require('./profileChangeEmailService');
const {
  PROFILE_SECTION_MAP,
  PROFILE_SECTION_LABELS,
} = require('../validators/userProfileValidator');

const SUB_CATEGORY_LABELS = {
  personalInfo: {
    firstName: 'First Name',
    lastName: 'Last Name',
    email: 'Email',
    phoneNumber: 'Phone Number',
    dateOfBirth: 'Date of Birth',
    placeOfBirth: 'Place of Birth',
    gender: 'Gender',
    fathersName: "Father's Name",
    maritalStatus: 'Marital Status',
    marriageDate: 'Marriage Date',
    spouseName: 'Spouse Name',
    spouseDob: 'Spouse DOB',
    hasChildren: 'Has Children',
    children: 'Children',
    nationality: 'Nationality',
    aadharCard: 'Aadhar Card',
    panCard: 'PAN Card',
    workExp: 'Work Experience',
    existingPfAccount: 'Existing PF Account',
    existingUan: 'UAN',
    emergencyContact: 'Emergency Contact',
    bloodRelation: 'Blood Relation',
  },
  addressDetails: {
    currentAddress: 'Current Address',
    permanentAddress: 'Permanent Address',
    sameAsCurrentAddress: 'Same As Current Address',
  },
  educationDetails: {
    tenth: '10th',
    twelfth: '12th',
    graduation: 'Graduation',
    postGraduation: 'Post Graduation',
  },
  documents: {
    photograph: 'Photograph',
    signature: 'Signature',
    panCard: 'PAN Card',
    aadharCardFront: 'Aadhar Card (Front)',
    aadharCardBack: 'Aadhar Card (Back)',
    addressProof: 'Address Proof',
    tenthMarkSheet: '10th Mark Sheet',
    twelfthMarkSheet: '12th Mark Sheet',
    graduationProof: 'Graduation Proof',
    updatedResume: 'Updated Resume',
    cancelledChequeOrPassbook: 'Cancelled Cheque / Passbook',
    form11: 'Form 11',
  },
  medicalInfo: {
    bloodGroup: 'Blood Group',
    hasMedicalHistory: 'Has Medical History',
    medicalHistoryDetails: 'Medical History Details',
  },
  backgroundInfo: {
    convicted: 'Convicted',
    convictedDetails: 'Convicted Details',
    courtProceeding: 'Court Proceeding',
    courtProceedingDetails: 'Court Proceeding Details',
  },
  bankDetails: {
    accountHolderName: 'Account Holder Name',
    bankName: 'Bank Name',
    branchName: 'Branch Name',
    accountNumber: 'Account Number',
    ifscCode: 'IFSC Code',
    accountType: 'Account Type',
  },
};

const DOCUMENT_REQUIREMENTS_BY_PARENT = {
  personalInfo: {
    aadharCard: {
      requiresDocuments: ['aadharCardFront', 'aadharCardBack'],
      errorMessage:
        'Aadhar number change requires updated Aadhar Front and Back documents.',
    },
    panCard: {
      requiresDocuments: ['panCard'],
      errorMessage: 'PAN card number change requires an updated PAN card document.',
    },
  },
  educationDetails: {
    tenth: {
      requiresDocuments: ['tenthMarkSheet'],
      errorMessage: '10th grade change requires an updated 10th Mark Sheet document.',
    },
    twelfth: {
      requiresDocuments: ['twelfthMarkSheet'],
      errorMessage: '12th grade change requires an updated 12th Mark Sheet document.',
    },
    graduation: {
      requiresDocuments: ['graduationProof'],
      errorMessage: 'Graduation change requires an updated Graduation Proof document.',
    },
  },
};

const BANK_DETAILS_DOCUMENT_REQUIREMENT = {
  requiresDocuments: ['cancelledChequeOrPassbook'],
  errorMessage:
    'Bank details change requires an updated Cancelled Cheque or Passbook document.',
};

const PROFILE_CHANGE_PARENT_FIELD_KEYS = [
  'personalInfo',
  'educationDetails',
  'bankDetails',
];

const MANDATORY_NEW_UPLOAD_DOCUMENT_KEYS = [
  'aadharCardFront',
  'aadharCardBack',
  'panCard',
  'tenthMarkSheet',
  'twelfthMarkSheet',
  'graduationProof',
  'cancelledChequeOrPassbook',
];

class ProfileChangeRequestService {
  normalizeAadhar(value) {
    return String(value || '').replace(/\s/g, '');
  }

  normalizePan(value) {
    return String(value || '').toUpperCase().trim();
  }

  hasAadharChanged(existingValue, newValue) {
    if (newValue === undefined || newValue === null || String(newValue).trim() === '') {
      return false;
    }
    return this.normalizeAadhar(existingValue) !== this.normalizeAadhar(newValue);
  }

  hasPanChanged(existingValue, newValue) {
    if (newValue === undefined || newValue === null || String(newValue).trim() === '') {
      return false;
    }
    return this.normalizePan(existingValue) !== this.normalizePan(newValue);
  }

  hasSectionObjectChanged(existingObj, newObj) {
    if (!newObj || typeof newObj !== 'object' || Array.isArray(newObj)) {
      return false;
    }

    const existing =
      existingObj && typeof existingObj === 'object' && !Array.isArray(existingObj)
        ? existingObj
        : {};

    for (const key of Object.keys(newObj)) {
      const newVal = String(newObj[key] ?? '').trim();
      if (!newVal) continue;
      const oldVal = String(existing[key] ?? '').trim();
      if (newVal !== oldVal) return true;
    }

    return false;
  }

  hasParentSectionChanged(parentFieldKey, subCategoryKey, existingSection, payload) {
    if (parentFieldKey === 'personalInfo') {
      if (subCategoryKey === 'aadharCard') {
        return this.hasAadharChanged(existingSection.aadharCard, payload.aadharCard);
      }
      if (subCategoryKey === 'panCard') {
        return this.hasPanChanged(existingSection.panCard, payload.panCard);
      }
      return false;
    }

    if (parentFieldKey === 'educationDetails') {
      return this.hasSectionObjectChanged(
        existingSection[subCategoryKey],
        payload[subCategoryKey]
      );
    }

    return false;
  }

  getDocumentLinksForField(parentFieldKey, subCategoryKey) {
    if (parentFieldKey === 'bankDetails') {
      return BANK_DETAILS_DOCUMENT_REQUIREMENT;
    }
    return DOCUMENT_REQUIREMENTS_BY_PARENT[parentFieldKey]?.[subCategoryKey] || null;
  }

  async findPendingDocumentRequestIds(userId, documentKeys) {
    const requests = await ProfileChangeRequest.find({
      userId,
      fieldKey: 'documents',
      subCategoryKey: { $in: documentKeys },
      status: 'pending',
      isNewUpload: true,
      isDeleted: { $ne: true },
      $or: [{ parentRequestId: null }, { parentRequestId: { $exists: false } }],
    }).select('_id subCategoryKey');

    const byKey = new Map(requests.map((request) => [request.subCategoryKey, request._id]));
    return documentKeys
      .map((key) => byKey.get(key))
      .filter(Boolean);
  }

  async validateBankDetailsDocumentRequirements(userId, payload, userDetailsDoc) {
    const existingSection =
      this.getExistingSectionValue(userDetailsDoc, 'bankDetails') || {};
    const links = {};

    const changedKeys = Object.keys(payload || {}).filter((key) => {
      const newVal = String(payload[key] ?? '').trim();
      if (!newVal) return false;
      const oldVal = String(existingSection[key] ?? '').trim();
      return newVal !== oldVal;
    });

    if (!changedKeys.length) return {};

    const linkedRequestIds = await this.findPendingDocumentRequestIds(
      userId,
      BANK_DETAILS_DOCUMENT_REQUIREMENT.requiresDocuments
    );

    if (
      linkedRequestIds.length <
      BANK_DETAILS_DOCUMENT_REQUIREMENT.requiresDocuments.length
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        BANK_DETAILS_DOCUMENT_REQUIREMENT.errorMessage
      );
    }

    for (const key of changedKeys) {
      links[key] = linkedRequestIds;
    }

    return links;
  }

  async validateSectionDocumentRequirements(
    userId,
    parentFieldKey,
    payload,
    userDetailsDoc
  ) {
    if (parentFieldKey === 'bankDetails') {
      return this.validateBankDetailsDocumentRequirements(
        userId,
        payload,
        userDetailsDoc
      );
    }

    const requirements = DOCUMENT_REQUIREMENTS_BY_PARENT[parentFieldKey];
    if (!requirements) return {};

    const existingSection =
      this.getExistingSectionValue(userDetailsDoc, parentFieldKey) || {};
    const links = {};

    for (const [subCategoryKey, config] of Object.entries(requirements)) {
      if (!(subCategoryKey in payload)) continue;

      const changed = this.hasParentSectionChanged(
        parentFieldKey,
        subCategoryKey,
        existingSection,
        payload
      );

      if (!changed) continue;

      const linkedRequestIds = await this.findPendingDocumentRequestIds(
        userId,
        config.requiresDocuments
      );

      if (linkedRequestIds.length < config.requiresDocuments.length) {
        throw new ApiError(httpStatus.BAD_REQUEST, config.errorMessage);
      }

      links[subCategoryKey] = linkedRequestIds;
    }

    return links;
  }

  async validateDocumentIdUploads(userId, payload, newUploadFields = []) {
    const newUploadSet = new Set(newUploadFields);
    const submittedKeys = Object.keys(payload || {});

    const pendingParents = await ProfileChangeRequest.find({
      userId,
      fieldKey: { $in: PROFILE_CHANGE_PARENT_FIELD_KEYS },
      status: 'pending',
      isDeleted: { $ne: true },
    }).select('subCategoryKey fieldKey requiresDocuments');

    for (const key of submittedKeys) {
      if (!MANDATORY_NEW_UPLOAD_DOCUMENT_KEYS.includes(key)) continue;
      if (newUploadSet.has(key)) continue;

      const label = this.getSubCategoryLabel('documents', key);
      const parentNeedsDoc = pendingParents.some((parent) => {
        const requiredDocs =
          parent.requiresDocuments ||
          (parent.fieldKey === 'bankDetails'
            ? BANK_DETAILS_DOCUMENT_REQUIREMENT.requiresDocuments
            : DOCUMENT_REQUIREMENTS_BY_PARENT[parent.fieldKey]?.[parent.subCategoryKey]
                ?.requiresDocuments) ||
          [];
        return requiredDocs.includes(key);
      });

      if (parentNeedsDoc) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Upload a new ${label} file. Existing document URL is not accepted while related profile change is pending.`
        );
      }

      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Upload a new file for ${label}. Re-submitting an existing URL is not allowed.`
      );
    }
  }

  async assertLinkedDocumentsApproved(request) {
    const linkConfig = this.getDocumentLinksForField(
      request.fieldKey,
      request.subCategoryKey
    );
    if (!linkConfig || !request.linkedRequestIds?.length) return;

    const linkedRequests = await ProfileChangeRequest.find({
      _id: { $in: request.linkedRequestIds },
      isDeleted: { $ne: true },
    }).select('status subCategoryKey');

    const allApproved =
      linkedRequests.length === request.linkedRequestIds.length &&
      linkedRequests.every((linked) => linked.status === 'approved');

    if (!allApproved) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot approve this change until related documents are approved.'
      );
    }
  }

  getSubCategoryLabel(fieldKey, subCategoryKey) {
    return (
      SUB_CATEGORY_LABELS[fieldKey]?.[subCategoryKey] ||
      subCategoryKey
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (char) => char.toUpperCase())
    );
  }

  detectValueType(routeKey, value) {
    if (routeKey === 'documents') return 'attachment';
    if (value !== null && typeof value === 'object') return 'object';
    return 'text';
  }

  formatDisplayValue(routeKey, value) {
    if (value === undefined || value === null) return value;

    if (routeKey === 'documents') {
      if (typeof value === 'string') {
        return transformDocumentPaths({ file: value }).file;
      }
      if (typeof value === 'object') {
        return transformDocumentPaths(value);
      }
    }

    return value;
  }

  splitPayloadToChangeUnits(routeKey, fieldKey, payload) {
    if (routeKey === 'employmentHistory') {
      return [
        {
          subCategoryKey: 'employment',
          subCategory: 'Employment History',
          proposedData: payload,
          changedValue: payload,
        },
      ];
    }

    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return [
        {
          subCategoryKey: fieldKey,
          subCategory: PROFILE_SECTION_LABELS[routeKey] || fieldKey,
          proposedData: payload,
          changedValue: payload,
        },
      ];
    }

    return Object.keys(payload).map((key) => ({
      subCategoryKey: key,
      subCategory: this.getSubCategoryLabel(fieldKey, key),
      proposedData: { [key]: payload[key] },
      changedValue: payload[key],
    }));
  }

  getExistingSectionValue(userDetailsDoc, fieldKey) {
    if (!userDetailsDoc) return null;
    const section =
      userDetailsDoc[fieldKey]?.toObject?.() || userDetailsDoc[fieldKey] || null;
    return section;
  }

  pickChangedKeysInitial(changedValue, fullValue) {
    if (changedValue === null || changedValue === undefined) {
      return fullValue ?? null;
    }

    if (Array.isArray(changedValue)) {
      return fullValue ?? null;
    }

    if (typeof changedValue !== 'object') {
      return fullValue ?? null;
    }

    const fullObject =
      fullValue && typeof fullValue === 'object' && !Array.isArray(fullValue)
        ? fullValue
        : {};

    const result = {};
    for (const key of Object.keys(changedValue)) {
      result[key] = this.pickChangedKeysInitial(changedValue[key], fullObject[key]);
    }
    return result;
  }

  getInitialValue(existingSection, routeKey, subCategoryKey, changedValue) {
    if (routeKey === 'employmentHistory') {
      return existingSection || [];
    }
    if (!existingSection || typeof existingSection !== 'object') {
      return this.pickChangedKeysInitial(changedValue, null);
    }

    const fullValue = existingSection[subCategoryKey] ?? null;
    return this.pickChangedKeysInitial(changedValue, fullValue);
  }

  async submitProfileChangeRequests(
    userId,
    routeKey,
    proposedSectionData,
    team,
    options = {}
  ) {
    const { newUploadFields = [] } = options;
    const fieldKey = PROFILE_SECTION_MAP[routeKey];
    if (!fieldKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid profile section.');
    }

    const user = await User.findOne({ _id: userId, isDeleted: { $ne: true } })
      .populate('department', 'name')
      .populate('teamLeadId', 'firstName lastName employeeId')
      .select('firstName lastName employeeId email team department teamLeadId userDetails');

    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found.');
    }

    let userDetailsDoc = null;
    if (user.userDetails) {
      userDetailsDoc = await UserDetails.findById(user.userDetails);
    }

    let documentLinks = {};
    if (routeKey === 'personalInfo') {
      documentLinks = await this.validateSectionDocumentRequirements(
        userId,
        'personalInfo',
        proposedSectionData,
        userDetailsDoc
      );
    }

    if (routeKey === 'education') {
      documentLinks = await this.validateSectionDocumentRequirements(
        userId,
        'educationDetails',
        proposedSectionData,
        userDetailsDoc
      );
    }

    if (routeKey === 'bankDetails') {
      documentLinks = await this.validateSectionDocumentRequirements(
        userId,
        'bankDetails',
        proposedSectionData,
        userDetailsDoc
      );
    }

    if (routeKey === 'documents') {
      await this.validateDocumentIdUploads(userId, proposedSectionData, newUploadFields);
    }

    const existingSection = this.getExistingSectionValue(userDetailsDoc, fieldKey);
    const category = PROFILE_SECTION_LABELS[routeKey] || routeKey;
    const units = this.splitPayloadToChangeUnits(routeKey, fieldKey, proposedSectionData);
    const createdRequests = [];
    const newUploadSet = new Set(newUploadFields);

    for (const unit of units) {
      const staleParents = await ProfileChangeRequest.find({
        userId,
        fieldKey,
        subCategoryKey: unit.subCategoryKey,
        status: 'pending',
        isDeleted: { $ne: true },
      }).select('_id');

      const staleParentIds = staleParents.map((parent) => parent._id);

      if (staleParentIds.length) {
        await ProfileChangeRequest.updateMany(
          { _id: { $in: staleParentIds } },
          { $set: { isDeleted: true } }
        );
        await ProfileChangeRequest.updateMany(
          { parentRequestId: { $in: staleParentIds } },
          { $unset: { parentRequestId: '' } }
        );
      }

      const initialValue = this.getInitialValue(
        existingSection,
        routeKey,
        unit.subCategoryKey,
        unit.changedValue
      );

      const linkConfig = this.getDocumentLinksForField(fieldKey, unit.subCategoryKey);
      const linkedRequestIds = documentLinks[unit.subCategoryKey] || [];

      const requestDoc = await ProfileChangeRequest.create({
        userId,
        team: team || user.team,
        fieldKey,
        routeKey,
        subCategoryKey: unit.subCategoryKey,
        category,
        subCategory: unit.subCategory,
        initialValue,
        changedValue: unit.changedValue,
        valueType: this.detectValueType(routeKey, unit.changedValue),
        proposedData: unit.proposedData,
        status: 'pending',
        isNewUpload:
          routeKey === 'documents' && newUploadSet.has(unit.subCategoryKey),
        ...(linkConfig
          ? {
              requiresDocuments: linkConfig.requiresDocuments,
              linkedRequestIds,
            }
          : {}),
      });

      if (linkedRequestIds.length) {
        await ProfileChangeRequest.updateMany(
          { _id: { $in: linkedRequestIds } },
          { $set: { parentRequestId: requestDoc._id } }
        );
      }

      createdRequests.push(requestDoc);
    }

    if (createdRequests.length) {
      profileChangeEmailService
        .notifySubmission(user, createdRequests)
        .catch((err) =>
          logger.error('Failed to send profile change submission emails:', err)
        );
    }

    return createdRequests.map((doc) => this.formatRequestRecord(doc, user));
  }

  normalizeStatusFilter(status) {
    if (!status) return [];
    const values = Array.isArray(status)
      ? status
      : String(status)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    const allowed = ['pending', 'approved', 'rejected'];
    return values.filter((value) => allowed.includes(value));
  }

  buildSearchConditions(search) {
    if (!search || !String(search).trim()) return null;

    const term = String(search).trim();
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    return {
      $or: [
        { firstName: regex },
        { lastName: regex },
        { employeeId: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: term,
              options: 'i',
            },
          },
        },
      ],
    };
  }

  async getProfileChangeRequests(requester, filters = {}, page = 1, limit = 10) {
    const { status, department, search } = filters;
    const statusFilter = this.normalizeStatusFilter(status);
    const isHrRole = ['admin', 'subadmin', 'hr'].includes(requester.role);
    const requesterObjectId =
      requester.id && mongoose.Types.ObjectId.isValid(requester.id)
        ? new mongoose.Types.ObjectId(requester.id)
        : null;

    const query = { isDeleted: { $ne: true }, team: requester.team };

    if (statusFilter.length) {
      query.status = { $in: statusFilter };
    }

    if (!isHrRole) {
      query.userId = requesterObjectId;
    } else if (department || search) {
      const userQuery = { team: requester.team, isDeleted: { $ne: true } };
      if (department) userQuery.department = department;
      const searchConditions = this.buildSearchConditions(search);
      if (searchConditions) Object.assign(userQuery, searchConditions);

      const matchedUsers = await User.find(userQuery).select('_id');
      query.userId = { $in: matchedUsers.map((user) => user._id) };
    } else if (search) {
      const searchConditions = this.buildSearchConditions(search);
      const matchedUsers = await User.find({
        team: requester.team,
        isDeleted: { $ne: true },
        ...searchConditions,
      }).select('_id');
      query.userId = { $in: matchedUsers.map((user) => user._id) };
    }

    const skip = (page - 1) * limit;
    const totalDocs = await ProfileChangeRequest.countDocuments(query);

    const pipeline = [
      { $match: query },
      {
        $addFields: {
          __sortPriority: {
            $switch: {
              branches: [
                ...(requesterObjectId
                  ? [
                      {
                        case: {
                          $and: [
                            { $eq: ['$userId', requesterObjectId] },
                            { $eq: ['$status', 'pending'] },
                          ],
                        },
                        then: 0,
                      },
                    ]
                  : []),
                { case: { $eq: ['$status', 'pending'] }, then: 1 },
              ],
              default: 2,
            },
          },
        },
      },
      { $sort: { __sortPriority: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    let requests = await ProfileChangeRequest.aggregate(pipeline);
    requests = await ProfileChangeRequest.populate(requests, [
      {
        path: 'userId',
        select: 'firstName lastName employeeId department teamLeadId',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'teamLeadId', select: 'firstName lastName employeeId' },
        ],
      },
      { path: 'reviewedBy', select: 'firstName lastName employeeId' },
    ]);

    const totalPages = Math.ceil(totalDocs / limit);

    return {
      data: requests.map((request) => this.formatRequestRecord(request)),
      pagination: {
        totalDocs,
        limit,
        totalPages,
        currentPage: page,
        pagingCounter: skip + 1,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
      },
    };
  }

  formatRequestRecord(request, fallbackUser = null) {
    const plain =
      typeof request.toObject === 'function'
        ? request.toObject({ virtuals: true })
        : { ...request };

    delete plain.__sortPriority;

    const employee = plain.userId || fallbackUser;
    const tl = employee?.teamLeadId;
    const department = employee?.department;

    const routeKey = plain.routeKey;

    return {
      id: String(plain._id),
      employeeName: employee
        ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim()
        : '',
      employeeId: employee?.employeeId || '',
      userId: employee?._id ? String(employee._id) : String(plain.userId),
      date: plain.createdAt,
      category: plain.category,
      subCategory: plain.subCategory,
      department: department?.name || '',
      tlName: tl ? `${tl.firstName || ''} ${tl.lastName || ''}`.trim() : '',
      initialValue: this.formatDisplayValue(
        routeKey,
        this.pickChangedKeysInitial(plain.changedValue, plain.initialValue)
      ),
      changedValue: this.formatDisplayValue(routeKey, plain.changedValue),
      valueType: plain.valueType,
      status: plain.status,
      approvalNote: plain.approvalNote || '',
      rejectNote: plain.rejectNote || '',
      reviewedBy: plain.reviewedBy
        ? {
            id: String(plain.reviewedBy._id),
            name: `${plain.reviewedBy.firstName || ''} ${plain.reviewedBy.lastName || ''}`.trim(),
            employeeId: plain.reviewedBy.employeeId || '',
          }
        : null,
      reviewedAt: plain.reviewedAt || null,
      fieldKey: plain.fieldKey,
      routeKey: plain.routeKey,
      subCategoryKey: plain.subCategoryKey,
      requiresDocuments: plain.requiresDocuments || [],
      linkedRequestIds: (plain.linkedRequestIds || []).map((id) => String(id)),
      parentRequestId: plain.parentRequestId ? String(plain.parentRequestId) : null,
      isNewUpload: Boolean(plain.isNewUpload),
      canApprove: plain.status === 'pending',
      canReject: plain.status === 'pending',
      createdAt: plain.createdAt,
      updatedAt: plain.updatedAt,
    };
  }

  async approveProfileChangeRequest(requestId, reviewer, note = '') {
    const request = await ProfileChangeRequest.findOne({
      _id: requestId,
      isDeleted: { $ne: true },
    });

    if (!request) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Profile change request not found.');
    }

    if (request.team !== reviewer.team) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Access denied for this request.');
    }

    if (request.status !== 'pending') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Request is already ${request.status}.`
      );
    }

    await this.assertLinkedDocumentsApproved(request);

    const userService = require('./userService');
    await userService.updateUserProfileSection(
      request.userId,
      request.fieldKey,
      request.proposedData,
      { directApply: true }
    );

    request.status = 'approved';
    request.approvalNote = note || '';
    request.reviewedBy = reviewer.id || reviewer._id;
    request.reviewedAt = new Date();
    await request.save();

    profileChangeEmailService
      .notifyApproved(request)
      .catch((err) =>
        logger.error('Failed to send profile change approval email:', err)
      );

    const populated = await ProfileChangeRequest.findById(request._id).populate([
      {
        path: 'userId',
        select: 'firstName lastName employeeId department teamLeadId',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'teamLeadId', select: 'firstName lastName employeeId' },
        ],
      },
      { path: 'reviewedBy', select: 'firstName lastName employeeId' },
    ]);

    return this.formatRequestRecord(populated);
  }

  async rejectProfileChangeRequest(requestId, reviewer, note = '') {
    const request = await ProfileChangeRequest.findOne({
      _id: requestId,
      isDeleted: { $ne: true },
    });

    if (!request) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Profile change request not found.');
    }

    if (request.team !== reviewer.team) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Access denied for this request.');
    }

    if (request.status !== 'pending') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Request is already ${request.status}.`
      );
    }

    request.status = 'rejected';
    request.rejectNote = note || '';
    request.reviewedBy = reviewer.id || reviewer._id;
    request.reviewedAt = new Date();
    await request.save();

    profileChangeEmailService
      .notifyRejected(request)
      .catch((err) =>
        logger.error('Failed to send profile change rejection email:', err)
      );

    const populated = await ProfileChangeRequest.findById(request._id).populate([
      {
        path: 'userId',
        select: 'firstName lastName employeeId department teamLeadId',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'teamLeadId', select: 'firstName lastName employeeId' },
        ],
      },
      { path: 'reviewedBy', select: 'firstName lastName employeeId' },
    ]);

    return this.formatRequestRecord(populated);
  }
}

module.exports = new ProfileChangeRequestService();
