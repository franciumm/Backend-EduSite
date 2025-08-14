import mongoose from 'mongoose';
import { asyncHandler } from '../utils/erroHandling.js';
import { toZonedTime } from 'date-fns-tz';
import { promises as fs } from 'fs';
import { CONTENT_TYPES } from '../utils/constants.js';

const uaeTimeZone = 'Asia/Dubai';


export const creationValidator = (contentType) => {
    return asyncHandler(async (req, res, next) => {
        // 1. File and Teacher Validation

          const mainFile = req.files?.file?.[0];
        const answerFile = req.files?.answerFile?.[0];

          const cleanupFiles = async () => {
            if (mainFile?.path) await fs.unlink(mainFile.path).catch(e => console.error("Error cleaning up main temp file:", e));
            if (answerFile?.path) await fs.unlink(answerFile.path).catch(e => console.error("Error cleaning up answer temp file:", e));
        };

        // 1. File and Teacher Validation
        // Check for the main file from req.files
        if (!mainFile) {
            await cleanupFiles(); // Clean up answer file if it exists
            return next(new Error(`Please upload the ${contentType} file.`, { cause: 400 }));
        }
        if (!req.isteacher) {
        await cleanupFiles();
return next(new Error(`Only teachers can create ${contentType}s.`, { cause: 403 }));
        }

        const { name, Name, gradeId } = req.body;
        const finalName = name || Name;
        const startDate = req.body.startDate || req.body.startdate;
        const endDate = req.body.endDate || req.body.enddate;
        // 2. Field Presence Validation
        if (!finalName || !startDate || !endDate || !gradeId) {
            await cleanupFiles();
            return next(new Error(`Missing required fields: name, startDate, endDate, and gradeId are required.`, { cause: 400 }));
        }
        
        // 3. Timeline Validation
        const parsedStartDate = new Date(startDate);
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime()) || toZonedTime(new Date(), uaeTimeZone) > parsedEndDate || parsedStartDate >= parsedEndDate) {
           await cleanupFiles();
            return next(new Error(`Invalid ${contentType} timeline. Ensure dates are valid, the end date is in the future, and the start date is before the end date.`, { cause: 400 }));
        }
        
        // 4. Group ID Parsing and Validation
        let rawGroupIds = req.body.groupIds ?? req.body["groupIds[]"];
        if (!rawGroupIds) {
           await cleanupFiles();
            return next(new Error("Group IDs are required.", { cause: 400 }));
        }
        if (typeof rawGroupIds === "string" && rawGroupIds.trim().startsWith("[")) {
            try { rawGroupIds = JSON.parse(rawGroupIds); } catch {}
        }
        const groupIds = Array.isArray(rawGroupIds) ? rawGroupIds : [rawGroupIds];
        if (groupIds.length === 0 || groupIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
           await cleanupFiles();
            return next(new Error("One or more Group IDs are invalid.", { cause: 400 }));
        }
        
        // 5. Assistant Permission Validation
        if (req.user.role === 'assistant') {
            const permissionKey = `${contentType}s`; // e.g., 'exams' or 'assignments'
            const permittedGroupIds = new Set(req.user.permissions[permissionKey]?.map(id => id.toString()));
            const hasPermissionForAllGroups = groupIds.every(id => permittedGroupIds.has(id.toString()));

            if (!hasPermissionForAllGroups) {
           await cleanupFiles();
                return next(new Error(`You do not have permission to create ${contentType}s for one or more of the selected groups.`, { cause: 403 }));
            }
        }
        
        // 6. Attach validated and parsed data to the request for the next controller
        req.validatedData = {
            ...req.body,
            name: finalName,
            startDate: parsedStartDate,
            endDate: parsedEndDate,
            groupIds: groupIds.map(id => new mongoose.Types.ObjectId(id))
        };
        
        next();
    });
};