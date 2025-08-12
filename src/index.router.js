import DBConnect from '../DB/DB.Connect.js';
import { globalerrorHandling, notFound } from './utils/erroHandling.js';
import cors from 'cors';
import auth from './auth/auth.router.js'
import group from "./Modules/Groups/Group.router.js"
import assg from './Modules/Assignments/Assg.router.js'
import exam  from './Modules/Exams/Exams.router.js'
import mater from "./Modules/Materials/Materials.router.js"
import section from "./Modules/Sections/section.router.js" 
import search from "./Modules/Search/search.router.js"     
import assistant from "./Modules/Assistants/assistant.router.js"     
import healthRouter from './Modules/health/health.router.js';

const bootstrape =  async (app,express)=>{
    app.use(express.json({limit :'10mb'}));

    app.use(express.urlencoded({ limit :'10mb', extended: false }));



    app.use('/group',group);
    app.use('/exams',exam);
    app.use("/assignments", assg)
    app.use('/student',auth);
    app.use('/material',mater);
    app.use('/sections', section); 
    app.use('/search', search);  
    app.use('/assistant', assistant);
    app.use('/health', healthRouter);
    app.use('*', notFound);          
    app.use(globalerrorHandling);

    
}


export default bootstrape;
