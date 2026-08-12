const Joi = require('joi');

const candidateCreateSchema = Joi.object({
  pointOfContact: Joi.string().optional().allow(null, ''),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  personalEmail: Joi.string().email().required(),
  phoneNumber: Joi.string().optional().allow(null, ''),
  employeeStatus: Joi.string().required(),
  designation: Joi.string().trim().allow('', null).optional(),
  department: Joi.string().trim().allow('', null).optional(),
  reportingLocation: Joi.string().required(),
  requestsSent: Joi.object({
    byod: Joi.boolean().optional(),
    byov: Joi.boolean().optional(),
  }).optional(),
  esicRequired: Joi.boolean().optional(),
  userDetails: Joi.object().optional(),
});


// Define regex patterns for validation consistency
const AADHAR_REGEX = /^\d{4}\s?\d{4}\s?\d{4}$/;
const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
const UAN_REGEX = /^\d{12}$/;

/**
 * @description Schema for validating a partial draft of the Candidate Information Form (CIF).
 * It allows any top-level key (e.g., 'personalInfo', 'addressDetails') to be present
 * while making all fields within them optional, except where conditionally required.
 */
const candidateDraftSchema = Joi.object({
  // Personal Info (only validate if present)
  personalInfo: Joi.object({
    firstName: Joi.string().min(1).optional(),
    lastName: Joi.string().min(1).optional(),
    email: Joi.string().email({ tlds: { allow: false } }).optional(), // Basic email validation
    phoneNumber: Joi.string().optional(),
    dateOfBirth: Joi.string().isoDate().optional(),
    placeOfBirth: Joi.string().min(1).optional(),
    gender: Joi.string().valid("male", "female", "other").optional(),
    fathersName: Joi.string().min(1).optional(),
    maritalStatus: Joi.string().valid("single", "married", "divorced", "widowed").optional(),

    // --- FIX: Corrected Joi.ref() to point to the sibling key 'maritalStatus' ---
    marriageDate: Joi.when("maritalStatus", {
      is: "married",
      then: Joi.string().isoDate().required(),
      otherwise: Joi.optional(),
    }),
    spouseName: Joi.when("maritalStatus", {
      is: "married",
      then: Joi.string().min(1).required(),
      otherwise: Joi.optional(),
    }),
    spouseDob: Joi.when("maritalStatus", {
      is: "married",
      then: Joi.string().isoDate().required(),
      otherwise: Joi.optional(),
    }),

    // Optional children fields
    hasChildren: Joi.string().valid("yes", "no").optional().allow(''),
    children: Joi.array().items(
      Joi.object({
        name: Joi.string().min(1).required(),
        dateOfBirth: Joi.string().isoDate().required(),
        gender: Joi.string().valid("male", "female", "other").required()
      })
    ).optional().allow(null, ''),

    nationality: Joi.string().min(1).optional(),
    aadharCard: Joi.string().pattern(AADHAR_REGEX).optional(),
    panCard: Joi.string().uppercase().pattern(PAN_REGEX).optional(),
    workExp: Joi.string().pattern(/^[0-9]+(\.[0-9]+)?$/).optional(),
    existingPfAccount: Joi.string().valid("yes", "no").optional(),

    existingUan: Joi.when("existingPfAccount", {
      is: "yes",
      then: Joi.string().pattern(UAN_REGEX).required(),
      otherwise: Joi.optional(),
    }),

    emergencyContact: Joi.object({
      name: Joi.string().min(1).optional(),
      relationship: Joi.string().min(1).optional(),
      phoneNumber: Joi.string().optional(),
    }).optional(),

    bloodRelation: Joi.object({
      hasRelation: Joi.boolean().optional(),
      details: Joi.when("hasRelation", {
        is: true,
        then: Joi.string().min(1).required(),
        otherwise: Joi.optional(),
      }),
    }).optional(),
  }).optional(),

  // Address Details
  addressDetails: Joi.object({
    currentAddress: Joi.object({
      address: Joi.string().min(1).optional(),
      district: Joi.string().min(1).optional(),
      city: Joi.string().min(1).optional(),
      state: Joi.string().min(1).optional(),
      pincode: Joi.string().min(1).optional(),
      country: Joi.string().min(1).optional(),
    }).optional(),
    permanentAddress: Joi.object({
      address: Joi.string().min(1).optional(),
      district: Joi.string().min(1).optional(),
      city: Joi.string().min(1).optional(),
      state: Joi.string().min(1).optional(),
      pincode: Joi.string().min(1).optional(),
      country: Joi.string().min(1).optional(),
    }).optional(),
    sameAsCurrentAddress: Joi.boolean().optional(),
  }).optional(),

  educationDetails: Joi.object({
    tenth: Joi.object({
      institute: Joi.string().min(1).required().messages({
        'string.min': 'Institute required',
        'string.empty': 'Institute required',
      }),
      board: Joi.string().min(1).required().messages({
        'string.min': 'Board required',
        'string.empty': 'Board required',
      }),
      passoutYear: Joi.string().min(1).required().messages({
        'string.min': 'Passout year required',
        'string.empty': 'Passout year required',
      }),
    }),
    twelfth: Joi.object({
      institute: Joi.string().min(1).required().messages({
        'string.min': 'Institute required',
        'string.empty': 'Institute required',
      }),
      board: Joi.string().min(1).required().messages({
        'string.min': 'Board required',
        'string.empty': 'Board required',
      }),
      stream: Joi.string().min(1).required().messages({
        'string.min': 'Stream required',
        'string.empty': 'Stream required',
      }),
      passoutYear: Joi.string().min(1).required().messages({
        'string.min': 'Passout year required',
        'string.empty': 'Passout year required',
      }),
    }),
    graduation: Joi.object({
      institute: Joi.string().min(1).required().messages({
        'string.min': 'Institute required',
        'string.empty': 'Institute required',
      }),
      course: Joi.string().min(1).required().messages({
        'string.min': 'Course required',
        'string.empty': 'Course required',
      }),
      type: Joi.string().min(1).required().messages({
        'string.min': 'Type required',
        'string.empty': 'Type required',
      }),
      passoutYear: Joi.string().min(1).required().messages({
        'string.min': 'Passout year required',
        'string.empty': 'Passout year required',
      }),
    }),
    postGraduation: Joi.object({
      institute: Joi.string().allow('', null),
      course: Joi.string().allow('', null),
      type: Joi.string().allow('', null),
      passoutYear: Joi.string().allow('', null),
    }),
  }).optional(),
  employment: Joi.array().optional(),
  medicalInfo: Joi.object().optional(),
  backgroundInfo: Joi.object().optional(),
  bankDetails: Joi.object().optional(),
  documents: Joi.object().optional(),
  certification: Joi.any().optional(),
  esicDetails: Joi.object({
    nomineeName: Joi.string().allow('', null).optional(),
    relation: Joi.string().allow('', null).optional(),
    familyMemberAadhaarNumber: Joi.string().allow('', null).optional(),
    nearestDispensaryAddress: Joi.string().allow('', null).optional(),
  }).optional(),

}).unknown(true);

const finalSubmitSchema = candidateDraftSchema.concat(
  Joi.object({
    personalInfo: Joi.object({
      firstName: Joi.string().min(1).required(),
      lastName: Joi.string().min(1).required(),
      email: Joi.string().email().required(),
      phoneNumber: Joi.string().required(),
      dateOfBirth: Joi.string().isoDate().required(),
      placeOfBirth: Joi.string().min(1).required(),
      gender: Joi.string().valid("male", "female", "other").required(),
      fathersName: Joi.string().min(1).required(),
      maritalStatus: Joi.string().valid("single", "married", "divorced", "widowed").required(),

      marriageDate: Joi.when(Joi.ref("..maritalStatus"), {
        is: "married",
        then: Joi.string().isoDate().required(),
        otherwise: Joi.forbidden(),
      }),
      spouseName: Joi.when(Joi.ref("..maritalStatus"), {
        is: "married",
        then: Joi.string().min(1).required(),
        otherwise: Joi.forbidden(),
      }),
      spouseDob: Joi.when(Joi.ref("..maritalStatus"), {
        is: "married",
        then: Joi.string().isoDate().required(),
        otherwise: Joi.forbidden(),
      }),

      // Child validation for married candidates
      hasChildren: Joi.when("maritalStatus", {
        is: "married",
        then: Joi.string().valid("yes", "no").required(),
        otherwise: Joi.optional().allow('', null),
      }),
      children: Joi.when("hasChildren", {
        is: "yes",
        then: Joi.array().items(
          Joi.object({
            name: Joi.string().min(1).required(),
            dateOfBirth: Joi.string().isoDate().required(),
            gender: Joi.string().valid("male", "female", "other").required()
          })
        ).min(1).required(),
        otherwise: Joi.optional().allow(null, ''),
      }),

      nationality: Joi.string().min(1).required(),
      aadharCard: Joi.string()
        .pattern(AADHAR_REGEX)
        .required(),
      panCard: Joi.string()
        .uppercase()
        .pattern(PAN_REGEX)
        .required(),
      workExp: Joi.string().pattern(/^[0-9]+(\.[0-9]+)?$/).required(),
      existingPfAccount: Joi.string().valid("yes", "no").required(),

      existingUan: Joi.when(Joi.ref("existingPfAccount"), {
        is: "yes",
        then: Joi.string().pattern(UAN_REGEX).required(),
        otherwise: Joi.forbidden(),
      }),

      emergencyContact: Joi.object({
        name: Joi.string().min(1).required(),
        relationship: Joi.string().min(1).required(),
        phoneNumber: Joi.string().required(),
      }).required(),

      bloodRelation: Joi.object({
        hasRelation: Joi.boolean().required(),
        details: Joi.when(Joi.ref("hasRelation"), {
          is: true,
          then: Joi.string().min(1).required(),
          otherwise: Joi.forbidden(),
        }),
      }).required(),
    }).required(),

    addressDetails: Joi.object({
      currentAddress: Joi.object({
        address: Joi.string().min(1).required(),
        district: Joi.string().min(1).required(),
        city: Joi.string().min(1).required(),
        state: Joi.string().min(1).required(),
        pincode: Joi.string().min(1).required(),
        country: Joi.string().min(1).required(),
      }).required(),
      permanentAddress: Joi.object({
        address: Joi.string().min(1).required(),
        district: Joi.string().min(1).required(),
        city: Joi.string().min(1).required(),
        state: Joi.string().min(1).required(),
        pincode: Joi.string().min(1).required(),
        country: Joi.string().min(1).required(),
      }).required(),
      sameAsCurrentAddress: Joi.boolean().required(),
    }).required(),

    educationDetails: Joi.object({
      tenth: Joi.object({
        institute: Joi.string().min(1).required().messages({
          'string.min': 'Institute required',
          'string.empty': 'Institute required',
        }),
        board: Joi.string().min(1).required().messages({
          'string.min': 'Board required',
          'string.empty': 'Board required',
        }),
        passoutYear: Joi.string().min(1).required().messages({
          'string.min': 'Passout year required',
          'string.empty': 'Passout year required',
        }),
      }),
      twelfth: Joi.object({
        institute: Joi.string().min(1).required().messages({
          'string.min': 'Institute required',
          'string.empty': 'Institute required',
        }),
        board: Joi.string().min(1).required().messages({
          'string.min': 'Board required',
          'string.empty': 'Board required',
        }),
        stream: Joi.string().min(1).required().messages({
          'string.min': 'Stream required',
          'string.empty': 'Stream required',
        }),
        passoutYear: Joi.string().min(1).required().messages({
          'string.min': 'Passout year required',
          'string.empty': 'Passout year required',
        }),
      }),
      graduation: Joi.object({
        institute: Joi.string().min(1).required().messages({
          'string.min': 'Institute required',
          'string.empty': 'Institute required',
        }),
        course: Joi.string().min(1).required().messages({
          'string.min': 'Course required',
          'string.empty': 'Course required',
        }),
        type: Joi.string().min(1).required().messages({
          'string.min': 'Type required',
          'string.empty': 'Type required',
        }),
        passoutYear: Joi.string().min(1).required().messages({
          'string.min': 'Passout year required',
          'string.empty': 'Passout year required',
        }),
      }),
      postGraduation: Joi.object({
        institute: Joi.string().allow('', null),
        course: Joi.string().allow('', null),
        type: Joi.string().allow('', null),
        passoutYear: Joi.string().allow('', null),
      }),
    }).required(),

    employment: Joi.array()
  .items(
    Joi.object({
      organization: Joi.string().allow('', null).optional(),
      from: Joi.string().isoDate().optional().allow('', null),
      to: Joi.string().isoDate().optional().allow('', null),
      address: Joi.string().allow('', null).optional(),
      jobTitle: Joi.string().allow('', null).optional(),
      reasonForLeaving: Joi.string().allow('', null).optional(),
      finalSalary: Joi.string().allow('', null).optional(),
      supervisorName: Joi.string().allow('', null).optional(),
      supervisorContact: Joi.string().allow('', null).optional(),
      employmentType: Joi.string().allow('', null).optional(),
      expectedCTC: Joi.string().allow('', null).optional(),
      expectedJoiningDate: Joi.string().isoDate().optional().allow('', null),
    })
  )
  .custom((value, helpers) => {
    if (!value || !Array.isArray(value)) {
      return value;
    }
    
    for (let i = 0; i < value.length; i++) {
      const entry = value[i];
      
      // Check if entry is effectively empty
      const isEffectivelyEmpty = 
        (!entry.organization || entry.organization.trim() === '') &&
        (!entry.from || entry.from.trim() === '') &&
        (!entry.to || entry.to.trim() === '') &&
        (!entry.jobTitle || entry.jobTitle.trim() === '') &&
        (!entry.address || entry.address.trim() === '') &&
        (!entry.reasonForLeaving || entry.reasonForLeaving.trim() === '') &&
        (!entry.finalSalary || entry.finalSalary.trim() === '') &&
        (!entry.supervisorName || entry.supervisorName.trim() === '') &&
        (!entry.supervisorContact || entry.supervisorContact.trim() === '') &&
        (!entry.employmentType || entry.employmentType.trim() === '') &&
        (!entry.expectedCTC || entry.expectedCTC.trim() === '') &&
        (!entry.expectedJoiningDate || entry.expectedJoiningDate.trim() === '');
      
      if (isEffectivelyEmpty) {
        continue; // Allow completely empty entries
      }
      
      // If not empty, validate required fields
      if (!entry.organization || entry.organization.trim() === '') {
        return helpers.error('array.includesRequiredUnknowns', { 
          message: `Employment entry ${i + 1}: Organization is required when employment details are provided` 
        });
      }
      
      if (!entry.from || entry.from.trim() === '') {
        return helpers.error('array.includesRequiredUnknowns', { 
          message: `Employment entry ${i + 1}: From date is required when employment details are provided` 
        });
      }
      
      if (!entry.to || entry.to.trim() === '') {
        return helpers.error('array.includesRequiredUnknowns', { 
          message: `Employment entry ${i + 1}: To date is required when employment details are provided` 
        });
      }
      
      if (!entry.jobTitle || entry.jobTitle.trim() === '') {
        return helpers.error('array.includesRequiredUnknowns', { 
          message: `Employment entry ${i + 1}: Job Title is required when employment details are provided` 
        });
      }
    }
    
    return value;
  })
  .optional(),


    medicalInfo: Joi.object({
      bloodGroup: Joi.string().optional(),
      hasMedicalHistory: Joi.string().valid("yes", "no").optional(),
      medicalHistoryDetails: Joi.when(Joi.ref("hasMedicalHistory"), {
        is: "yes",
        then: Joi.string().min(1).optional(),
        otherwise: Joi.optional().allow('', null),
      }).optional(),
    }).optional(),

    backgroundInfo: Joi.object({
      convicted: Joi.string().valid("yes", "no").required(),
      convictedDetails: Joi.when(Joi.ref("convicted"), {
        is: "yes",
        then: Joi.string().min(1).required(),
        otherwise: Joi.forbidden(),
      }),
      courtProceeding: Joi.string().valid("yes", "no").required(),
      courtProceedingDetails: Joi.when(Joi.ref("courtProceeding"), {
        is: "yes",
        then: Joi.string().min(1).required(),
        otherwise: Joi.forbidden(),
      }),
    }).required(),

    bankDetails: Joi.object({
      accountHolderName: Joi.string().min(1).required(),
      bankName: Joi.string().min(1).required(),
      branchName: Joi.string().min(1).required(),
      accountNumber: Joi.string().min(8).required(),
      ifscCode: Joi.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i).required(),
      accountType: Joi.string().valid("savings", "current", "fixed", "salary").required(),
    }).required(),

    documents: Joi.object({
      // --- Required Documents ---
      photograph: Joi.string().required(),
      signature: Joi.string().required(),
      panCard: Joi.string().required(),
      aadharCardFront: Joi.string().required(),
      aadharCardBack: Joi.string().required(),
      addressProof: Joi.string().required(),
      tenthMarkSheet: Joi.string().required(),
      twelfthMarkSheet: Joi.string().required(),
      graduationProof: Joi.string().required(),
      updatedResume: Joi.string().required(),
      cancelledChequeOrPassbook: Joi.string().required(),
      form11: Joi.string().optional().allow(null, ''),

      // --- Optional Documents ---
      postGraduationProof: Joi.string().optional().allow(null, ''),
      offerLetter: Joi.string().optional().allow(null, ''),
      relievingLetter: Joi.string().optional().allow(null, ''),
      salarySlipOne: Joi.string().optional().allow(null, ''),
      salarySlipTwo: Joi.string().optional().allow(null, ''),
      salarySlipThree: Joi.string().optional().allow(null, ''),
    }).required(),
    certification: Joi.optional(),
    esicDetails: Joi.object({
      nomineeName: Joi.string().min(1).optional(),
      relation: Joi.string().min(1).optional(),
      familyMemberAadhaarNumber: Joi.string().min(1).optional(),
      nearestDispensaryAddress: Joi.string().min(1).optional(),
    }).optional(),
  })
);

module.exports = {
  candidateCreateSchema,
  candidateDraftSchema,
  finalSubmitSchema,
};
