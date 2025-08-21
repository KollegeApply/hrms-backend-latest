const { BlobServiceClient } = require("@azure/storage-blob");
const dotenv = require("dotenv");
const path = require("path");
const mime = require("mime-types");

dotenv.config();

const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'sd-cms-stg';
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

async function uploadToAzure(fileBuffer, originalName, folderName = 'hrms-cif-documents/') {
  
  const cleanName = originalName.replace(/\s+/g, '_');
  const timestamp = Date.now();
  const fileName = `${folderName}/${timestamp}-${cleanName}`.replace(/\/+/g, '/');

  const contentType = mime.lookup(originalName) || 'application/octet-stream';

  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  await blockBlobClient.uploadData(fileBuffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      blobContentDisposition: 'inline'
    },
  });

  return fileName;
}

module.exports = { uploadToAzure };
