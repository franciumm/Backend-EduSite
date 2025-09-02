
import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path';
import { s3 } from './S3Client.js'; // Import your configured S3 client
import { allowedExtensions } from './allowedExtensions.js';

export const multerCloudFunction = (allowedExtensionsArr) => {
  if (!allowedExtensionsArr) {
    allowedExtensionsArr = allowedExtensions.Files;
  }

  //================================== Storage Engine =============================
  // This is the core change. We replace diskStorage with the multerS3 engine.
  const storage = multerS3({
    s3: s3, // Your configured S3 client from S3Client.js
    bucket: process.env.S3_BUCKET_NAME, // The S3 bucket to upload to
    acl: 'private', // Access control for the file
    contentType: multerS3.AUTO_CONTENT_TYPE, // Automatically set the correct Content-Type

    // This function generates a unique key (filename) for each file in S3.
    key: function (req, file, cb) {
      const { assignmentId, examId, name, Name } = req.body;
      const contentName = name || Name || 'content';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fileName = `${uniqueSuffix}${path.extname(file.originalname)}`;
      
      // Dynamically determine the folder based on the route/request body
      let folder = `uploads/other/${contentName}/`;
      if (req.originalUrl.includes('/assignments/submit')) {
        folder = `AssignmentSubmissions/${assignmentId}/`;
      } else if (req.originalUrl.includes('/exams/submit')) {
        folder = `ExamSubmissions/${examId}/`;
      } else if (req.originalUrl.includes('/assignments/create') || req.originalUrl.includes('/assignments/edit')) {
        folder = `assignments/${contentName.replace(/\s+/g, '_')}/`;
      } else if (req.originalUrl.includes('/exams/create') || req.originalUrl.includes('/exams/edit')) {
        folder = `exams/${contentName.replace(/\s+/g, '_')}/`;
      }
      
      cb(null, folder + fileName);
    }
  });

  //================================== File Filter =============================
  const fileFilter = function (req, file, cb) {
    if (allowedExtensionsArr.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Invalid file extension', { cause: 400 }), false);
  };

  const fileUpload = multer({
    fileFilter,
    storage, // Use our new S3 storage engine
  });
  
  return fileUpload;
};