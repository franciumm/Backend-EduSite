import { courseModel } from "../../../DB/models/course.model.js";
import { asyncHandler } from "../../utils/erroHandling.js"; 

import { pagination } from "../../utils/pagination.js"; // Make sure path is correct

export const GetAll = asyncHandler(
    async (req, res, next) => {
        // 1. Get page and size from the query string, with default values
        const { page, size } = req.query;

        // 2. Get the limit and skip values from our pagination function
        const { limit, skip } = pagination({ page, size });

        // 3. Find the requested slice of documents from the database
        const courses = await courseModel.find()
            .limit(limit)
            .skip(skip);

        // 4. (Optional but Recommended) Get the total number of documents to calculate total pages
        const totalCourses = await courseModel.countDocuments();
        const totalPages = Math.ceil(totalCourses / limit);

        // 5. Send the paginated data and metadata in the response
        res.status(200).json({
            message: "Courses fetched successfully.",
            data: {
                courses,
                pagination: {
                    totalCourses,
                    totalPages,
                    currentPage: parseInt(page) || 1,
                    limit
                }
            }
        });
    }
);
export const create = asyncHandler(
    async (req, res, next) => {
        const { courseName, name, email, phone, grade, description } = req.body;

     
      
        const course = await courseModel.create({ courseName, name, email, phone, grade, description });

        res.status(201).json({ message: "Course request created successfully.", data: course });
    }
);

export const deleteCourse = asyncHandler(
    async (req, res, next) => {
        const { requests } = req.body;

        if (!requests || !Array.isArray(requests) || requests.length === 0) {
            return next(new Error("Please provide an array of request IDs to delete.", { cause: 400 }));
        }

        const deleteResult = await courseModel.deleteMany({ _id: { $in: requests } });

        if (deleteResult.deletedCount === 0) {
            return next(new Error("No matching courses found for the provided IDs.", { cause: 404 }));
        }

        res.status(200).json({
            message: `Successfully deleted ${deleteResult.deletedCount} course requests.`
        });
    }
);