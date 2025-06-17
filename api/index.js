import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bootstrape from "../src/index.router.js"; // Import the setup function
import DBConnect from "../DB/DB.Connect.js";

dotenv.config();

const app = express();console.log(`Is MONGOCONNECT variable present? ${!!process.env.MONGOCONNECT}`);

// --- STEP 2: SET UP DETAILED CONNECTION LISTENERS ---
// This will give us definitive proof of the connection's state.

mongoose.connection.on('connected', () => {
    console.log('[Mongoose Event] => connected');
});

mongoose.connection.on('error', err => {
    // This will catch any errors that happen AFTER the initial connection
    console.error('[Mongoose Event] => error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('[Mongoose Event] => disconnected');
});

// Disable buffering globally as a best practice.
mongoose.set('bufferCommands', false);


const startServer = async () => {
  try {
    console.log("Connecting to database...");
    
    // 1. Connect to the database directly.
    await DBConnect;
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