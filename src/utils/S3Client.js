import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize S3 Client
export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Upload File to S3
export const uploadFileToS3 = async (bucketName, key, body, contentType) => {
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    
  };

  try {
    const command = new PutObjectCommand(params);
    const response = await s3.send(command);
    console.log(`File uploaded successfully: ${key}`);
    return response;
  } catch (error) {
    console.error(`Error uploading file to S3: ${error.message}`);
    throw new Error("Error uploading file to S3");
  }
};

// Delete File from S3
export const deleteFileFromS3 = async (bucketName, key) => {
  const params = {
    Bucket: bucketName,
    Key: key,
  };

  try {
    const command = new DeleteObjectCommand(params);
    await s3.send(command);
    console.log(`File deleted successfully: ${key}`);
  } catch (error) {
    console.error(`Error deleting file from S3: ${error.message}`);
    throw new Error("Error deleting file from S3");
  }
};

// Generate Presigned URL for Download
export const getPresignedUrlForS3 = async (bucketName, key, expiresIn = 3600) => {
  const params = {
    Bucket: bucketName,
    Key: key,
  };

  try {
    const command = new GetObjectCommand(params);
    const url = await getSignedUrl(s3, command, { expiresIn });
    console.log(`Generated presigned URL: ${url}`);
    return url;
  } catch (error) {
    console.error(`Error generating presigned URL: ${error.message}`);
    throw new Error("Error generating presigned URL");
  }
};
