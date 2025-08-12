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



router.get("/grades",isAuth, Search.Bygrade);


router.get("/id",isAuth,  Search.ById);



router.delete("/deletegroup", AdminAuth
, Edit.groupDelete);


router.delete("/removestudent",isAuth, 
canManageGroupStudents, Edit.removeStudent);


router.put("/addstudent", isAuth,    
canManageGroupStudents, Edit.addStudent);

export default router;