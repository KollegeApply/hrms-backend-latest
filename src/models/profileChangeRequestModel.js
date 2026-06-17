const mongoose = require('mongoose');
const { Schema } = mongoose;

const profileChangeRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    team: { type: String, required: true, trim: true, index: true },
    fieldKey: { type: String, required: true, trim: true },
    routeKey: { type: String, required: true, trim: true },
    subCategoryKey: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, required: true, trim: true },
    initialValue: { type: Schema.Types.Mixed },
    changedValue: { type: Schema.Types.Mixed },
    valueType: {
      type: String,
      enum: ['text', 'attachment', 'object'],
      default: 'text',
    },
    proposedData: { type: Schema.Types.Mixed, required: true },
    requiresDocuments: [{ type: String, trim: true }],
    linkedRequestIds: [{ type: Schema.Types.ObjectId, ref: 'ProfileChangeRequest' }],
    parentRequestId: { type: Schema.Types.ObjectId, ref: 'ProfileChangeRequest' },
    isNewUpload: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    approvalNote: { type: String, trim: true, maxlength: 1000 },
    rejectNote: { type: String, trim: true, maxlength: 1000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

profileChangeRequestSchema.index({ team: 1, status: 1, createdAt: -1 });
profileChangeRequestSchema.index({
  userId: 1,
  fieldKey: 1,
  subCategoryKey: 1,
  status: 1,
});
profileChangeRequestSchema.index({ parentRequestId: 1, status: 1 });

module.exports = mongoose.model('ProfileChangeRequest', profileChangeRequestSchema);
