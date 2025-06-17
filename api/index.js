import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bootstrape from "../src/index.router.js"; // Import the setup function
import DBConnect from "../DB/DB.Connect.js";

dotenv.config();

const app = express();


const startServer = async () => {
  try {
    console.log("Connecting to database...");
    
    // 1. Connect to the database directly.
    await DBConnect();
    console.log("DB Connected successfully.");

    // 2. Now that the connection is live, set up the Express app.
    // This will now safely import all your routers and models.
    bootstrape(app, express);

    console.log("Application bootstrap complete. Server is ready for requests.");

  } catch (error) {
    console.error("Failed to start server:", error);
    // If the DB connection fails, the app should not start.
    process.exit(1);
  }
};

// Start the entire process.
startServer();

// Export the app instance for the serverless environment (e.g., Vercel).
export default app;