
 import dotenv from "dotenv";
 import bootstrape from "../src/index.router.js"; 


  dotenv.config();



import express from "express";

const app = express();


 bootstrape(app, express);


// When using @vercel/node and a file in the /api directory,
// exporting the app instance directly allows Vercel to handle wrapping it.
export default app;