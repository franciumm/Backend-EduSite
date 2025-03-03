import express  from "express"
import bootstrape from "./src/index.router.js";
import dotenv from 'dotenv'
dotenv.config();
const app = express();
app.listen( process.env.PORT || 8080, () => {
    console.log(`App is running on port ${process.env.PORT } ......`);
});
bootstrape(app,express);
