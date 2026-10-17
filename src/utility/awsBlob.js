const AWS = require("aws-sdk");
const dotenv = require("dotenv");
const mime = require("mime-types");
// [AZURE-DISABLED] const { BlobServiceClient } = require("@azure/storage-blob");

dotenv.config();

// [AZURE-DISABLED] // Azure Blob is used only when STORAGE_PROVIDER=azure (set on Azure DEV); otherwise S3 as before
// [AZURE-DISABLED] const useAzure = process.env.STORAGE_PROVIDER === "azure";
// [AZURE-DISABLED] const azureContainer = useAzure
  // [AZURE-DISABLED] ? BlobServiceClient.fromConnectionString(process.env.AZURE_BLOB_CONNECTION_STRING)
      // [AZURE-DISABLED] .getContainerClient(process.env.AZURE_BLOB_CONTAINER)
  // [AZURE-DISABLED] : null;

// AWS S3 CONFIG
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

async function uploadToAWS(fileBuffer, originalName, folderName = 'hrms-cif-documents/') {
  const cleanName = originalName.replace(/\s+/g, '_');
  const timestamp = Date.now();
  const fileName = `${folderName}/${timestamp}-${cleanName}`.replace(/\/+/g, '/');
  
  const contentType = mime.lookup(originalName) || 'application/octet-stream';

  // [AZURE-DISABLED] if (useAzure) {
    // [AZURE-DISABLED] // Returns the same relative path format as the S3 branch below
    // [AZURE-DISABLED] await azureContainer.getBlockBlobClient(fileName).uploadData(fileBuffer, {
      // [AZURE-DISABLED] blobHTTPHeaders: { blobContentType: contentType },
    // [AZURE-DISABLED] });
    // [AZURE-DISABLED] return fileName.replace(/^\//, '');
  // [AZURE-DISABLED] }

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileName,
    Body: fileBuffer,
    ContentType: contentType,
  };

  const uploadResult = await s3.upload(params).promise();

  // If production → Replace S3 URL with CloudFront or custom domain
  // if (process.env.NODE_ENV === "production" && process.env.AWS_S3_BASE_URL) {
    const s3Url = uploadResult.Location;
    const bucketBase = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
    const relativePath = s3Url.replace(bucketBase, "");
    
    return `${relativePath.replace(/^\//, '')}`;
  // }
}

module.exports = { uploadToAWS };
