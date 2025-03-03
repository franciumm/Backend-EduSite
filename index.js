import express  from "express"
import bootstrape from "./src/index.router.js";
import dotenv from 'dotenv'
dotenv.config();
const app = express();
app.listen(process.env.PORT,()=>{console.log(`Server Running ${process.env.PORT}`);});
bootstrape(app,express);
