import { Router } from "express";
import * as Start from "./controller/start.js";
import * as Edit from "./controller/edit.js";
import * as Search from "./controller/search.js";
import { AdminAuth, isAuth ,canManageGroupStudents} from "../../middelwares/auth.js";
import { requestTimeout } from "../../middelwares/requestTimeout.js"; 
import isValid from "../../middelwares/JoiValidation.js"; // Assuming the file is named validation.js
import * as validators from "./groups.validation.js";

const router = Router();



router.post('/create', 
AdminAuth,    

 Start.create);


router.get('/all',isAuth, Search.getall);





router.get("/id",isAuth,  Search.ById);



router.delete("/deletegroup", AdminAuth
, Edit.groupDelete);


router.delete("/removestudent",isAuth, 
canManageGroupStudents, Edit.removeStudent);


router.put("/addstudent", isAuth,    
canManageGroupStudents, Edit.addStudentsToGroup);


router.post('/invite/create', 
    AdminAuth,
    isValid(validators.manageInviteLink),
    Edit.createInviteLink
);
router.get('/invite/link',
    AdminAuth, // Only main_teacher can view the link
    isValid(validators.getInviteLink, "query"), // Validate groupid from query params
    Edit.getInviteLink
);
// Main Teacher deletes/disables an invite link for a group
router.delete('/invite/delete',
    AdminAuth,
    isValid(validators.manageInviteLink),
    Edit.deleteInviteLink
);



// Student joins a group using the token from the invite link
router.post('/join/:inviteToken',
    isAuth,
    isValid(validators.joinWithInviteLink),
    Edit.joinWithInviteLink
);



export default router;