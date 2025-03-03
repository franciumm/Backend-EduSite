import { Router } from "express";
import * as Start from "./controller/start.js" ;
import * as Edit from "./controller/edit.js"
import * as Search from "./controller/search.js"
import { AdminAuth } from "../../middelwares/auth.js";
const router = Router();



router.post ('/create',AdminAuth,Start.create);

router.get ('/all',AdminAuth,Search.getall);
router.get("/grades",AdminAuth,Search.Bygrade );
router.get("/id",AdminAuth,Search.ById );
router.delete("/deletegroup",AdminAuth, Edit.groupDelete);
router.delete("/removestudent",AdminAuth, Edit.removeStudent);
router.put("/addstudent",AdminAuth, Edit.addStudent);


export default router ;

