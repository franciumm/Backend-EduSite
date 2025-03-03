import express  from "express"
import bootstrape from "./src/index.router.js";
import dotenv from 'dotenv'
dotenv.config();
const app = express();
app.listen( process.env.PORT || 3000);
bootstrape(app,express);
