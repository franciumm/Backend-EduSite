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

router.patch("/archive", AdminAuth, Edit.archiveOrRestore);

router.put("/addstudent", isAuth,    
canManageGroupStudents, Edit.addStudentsToGroup);

//  gets 

router.get('/all',isAuth, Search.getall);


router.get("/id",isAuth,  Search.ById);

//  Deletes


router.delete("/deletegroup", AdminAuth
, Edit.groupDelete);


router.delete("/removestudent",isAuth, 
canManageGroupStudents, Edit.removeStudent);




//   Invite endpoints

router.post('/invite/create', 
    AdminAuth,
    isValid(validators.manageInviteLink),
    Edit.createInviteLink
);
router.get('/invite/link',
    AdminAuth,  
    isValid(validators.getInviteLink, "query"), 
    Edit.getInviteLink
);

router.delete('/invite/delete',
    AdminAuth,
    isValid(validators.manageInviteLink),
    Edit.deleteInviteLink
);



router.post('/join/:inviteToken',
    isAuth,
    isValid(validators.joinWithInviteLink),
    Edit.joinWithInviteLink
);



export default router;