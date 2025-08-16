import { courseModel } from "../../../DB/models/course.model.js";
import { asyncHandler } from "../../utils/asyncHandler.js"; // Or erroHandling.js if that's the correct name

export const GetAll = asyncHandler(
    async (req, res, next) => {
        const courses = await courseModel.find();
        res.status(200).json({ message: "Courses fetched successfully.", data: courses });
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