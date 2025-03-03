import DBConnect from '../DB/DB.Connect.js';
import { globalerrorHandling } from './utils/erroHandling.js';
import cors from 'cors';
import auth from './auth/auth.router.js'
import group from "./Modules/Groups/Group.router.js"
import assg from './Modules/Assignments/Assg.router.js'
import exam  from './Modules/Exams/Exams.router.js'
const bootstrape =  async (app,express)=>{
    const whitelist = ["http://127.0.0.1:5500"];
    app.use(express.json());
    
    app.use(cors());
  
    DBConnect();
 
    app.use(express.urlencoded({ extended: false }));

    app.use('/group',group);
    app.use('/exams',exam);
    app.use("/assignments", assg)
    app.use('/student',auth);


    app.use(globalerrorHandling);
    app.use('*',(req,res,next) => {return res.status(404).json('In-Valid Routing')});

    
}


export default bootstrape;
