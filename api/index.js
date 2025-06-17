
 import dotenv from "dotenv";
 import bootstrape from "../src/index.router.js"; 


  dotenv.config();



import express from "express";

const app = express();

(async () => {
  try {
    console.log("Starting application bootstrap...");
    // AWAITING HERE is the key. Nothing after this line will run
    // until the database is connected and all middlewares are set up.
    await bootstrape(app, express);
    console.log("Bootstrap complete. Application is ready.");
  } catch (error) {
    console.error("Failed to bootstrap the application:", error);
  }
})();


// When using @vercel/node and a file in the /api directory,
// exporting the app instance directly allows Vercel to handle wrapping it.
export default app;