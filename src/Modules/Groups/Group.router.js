import { Router } from "express";
import * as Start from "./controller/start.js";
import * as Edit from "./controller/edit.js";
import * as Search from "./controller/search.js";
import { AdminAuth, isAuth ,canManageGroupStudents} from "../../middelwares/auth.js";
import { requestTimeout } from "../../middelwares/requestTimeout.js"; 
import isValid from "../../middelwares/JoiValidation.js"; // Assuming the file is named validation.js
import * as validators from "./groups.validation.js";

const router = Router();



router.post('/create', isValid(validators.headers),
AdminAuth,    isValid(validators.createGroup), 

 Start.create);


router.get('/all', isValid(validators.headers),isAuth, Search.getall);



router.get("/grades",isValid(validators.headers), isAuth,  isValid(validators.getGroupByGrade), Search.Bygrade);


router.get("/id",isValid(validators.headers), isAuth,isValid(validators.getGroupById),  Search.ById);



router.delete("/deletegroup",isValid(validators.headers), AdminAuth
,    isValid(validators.deleteGroup), 
 Edit.groupDelete);


router.delete("/removestudent", isValid(validators.headers),isAuth,isValid(validators.addOrRemoveStudent), 
canManageGroupStudents, Edit.removeStudent);


router.put("/addstudent",isValid(validators.headers), isAuth,    isValid(validators.addOrRemoveStudent), 
canManageGroupStudents, Edit.addStudent);

export default router;