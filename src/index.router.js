import DBConnect from '../DB/DB.Connect.js';
import { globalerrorHandling } from './utils/erroHandling.js';
import cors from 'cors';
import auth from './auth/auth.router.js'
import group from "./Modules/Groups/Group.router.js"
import assg from './Modules/Assignments/Assg.router.js'
import exam  from './Modules/Exams/Exams.router.js'
import mater from "./Modules/Materials/Materials.router.js"
import section from "./Modules/Sections/section.router.js" 
import search from "./Modules/Search/search.router.js"     // 2. Import the new search router

const bootstrape =  async (app,express)=>{
    const whitelist = ["http://127.0.0.1:5500"];
    app.use(express.json({limit :'10mb'}));
    
    app.use(cors());
  
    DBConnect();
 
    app.use(express.urlencoded({ extended: false }));

    app.use('/group',group);
    app.use('/exams',exam);
    app.use("/assignments", assg)
    app.use('/student',auth);
    app.use('/material',mater);
    app.use('/sections', section); // 2. Register the new router with the app
    app.use('/search', search);  
    app.use(globalerrorHandling);
    app.use('*',(req,res,next) => {return res.status(404).json('In-Valid Routing')});

    
}


export default bootstrape;
