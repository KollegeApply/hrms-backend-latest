const mongoose = require('mongoose');
const { Schema } = mongoose;

const EmploymentSchema = new Schema({
  organization: String,
  from: Date,
  to: Date,
  address: String,
  jobTitle: String,
  reasonForLeaving: String,
  finalSalary: String,
  supervisorName: String,
  supervisorContact: String,
  employmentType: String,
  expectedCTC: String,
  expectedJoiningDate: Date
}, { _id: false });

const AddressSchema = new Schema({
  address: String,
  district: String,
  city: String,
  state: String,
  pincode: String,
  country: String,
}, { _id: false });

const EducationSchema = new Schema({
  tenth: {
    institute: String,
    board: String,
    passoutYear: String
  },
  twelfth: {
    institute: String,
    board: String,
    stream: String,
    passoutYear: String
  },
  graduation: {
    type:Object,
  },
  postGraduation: {
    type:Object,
  },
}, { _id: false });

const MedicalInfoSchema = new Schema({
  bloodGroup: String,
  hasMedicalHistory: String,
  medicalHistoryDetails: String,
}, { _id: false });

const BackgroundInfoSchema = new Schema({
  convicted: String,
  convictedDetails: String,
  courtProceeding: String,
  courtProceedingDetails: String,
}, { _id: false });

const BankDetailsSchema = new Schema({
  accountHolderName: String,
  bankName: String,
  branchName: String,
  accountNumber: String,
  ifscCode: String,
  accountType: String
}, { _id: false });

const EmergencyContactSchema = new Schema({
  name: String,
  relationship: String,
  phoneNumber: String
}, { _id: false });

const ChildSchema = new Schema({
  name: String,
  dateOfBirth: Date,
  gender: String
}, { _id: false });

const BloodRelationSchema = new Schema({
  hasRelation: Boolean,
  details: String
}, { _id: false });

const DocumentsSchema = new Schema({
  photograph: String,
  signature: String,
  panCard: String,
  aadharCardFront: String,
  aadharCardBack: String,
  addressProof: String,
  tenthMarkSheet: String,
  twelfthMarkSheet: String,
  graduationProof: String,
  updatedResume: String,
  cancelledChequeOrPassbook: String,
  form11: String,
  //optional docs
  postGraduationProof: String,
  offerLetter: String,
  relievingLetter: String,
  salarySlipOne: String,
  salarySlipTwo: String,
  salarySlipThree: String,
}, { _id: false });

const PersonalInfoSchema = new Schema({
  firstName: String,
  lastName: String,
  email: String,
  phoneNumber: String,
  dateOfBirth: Date,
  placeOfBirth: String,
  gender: String,
  fathersName: String,
  maritalStatus: String,
  marriageDate: Date,
  spouseName: String,
  spouseDob: Date,
  hasChildren: String,
  children: [ChildSchema],
  nationality: String,
  aadharCard: String,
  panCard: String,
  workExp: String,
  existingPfAccount: String,
  existingUan: String,
  emergencyContact: EmergencyContactSchema,
  bloodRelation: BloodRelationSchema,
}, { _id: false });


const UserDetailsSchema = new Schema({
  personalInfo: PersonalInfoSchema,
  addressDetails: {
    currentAddress: AddressSchema,
    permanentAddress: AddressSchema,
    sameAsCurrentAddress: { type: Boolean, default: false },
  },
  educationDetails: EducationSchema,
  employment: [EmploymentSchema],
  medicalInfo: MedicalInfoSchema,
  backgroundInfo: BackgroundInfoSchema,
  bankDetails: BankDetailsSchema,
  documents: DocumentsSchema,
  certification: {
    type: Boolean,
    default: false
  },
  lockedFields: {
    type: [String],
    default: []
  },
  comments: {
    type: String,
  },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('UserDetails', UserDetailsSchema);
