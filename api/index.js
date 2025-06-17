import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bootstrape from "../src/index.router.js"; // Import the setup function
import DBConnect from "../DB/DB.Connect.js";

dotenv.config();
const app = express();



    bootstrape(app, express);

   


// Export the app instance for the serverless environment (e.g., Vercel).
export default app;