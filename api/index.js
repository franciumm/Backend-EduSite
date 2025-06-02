import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import bootstrape from "../src/index.router.js"; 

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();

console.log("API Handler (api/index.js) starting...");
try {
  bootstrape(app, express); console.log("Bootstrap function executed successfully.");
} catch (error) {
  console.error("Error during bootstrap execution:", error);
}
app.get("/ping", (req, res) => {
  console.log("Request received for /ping route in api/index.js");
  res.status(200).json({ message: "Pong! Service is alive from api/index.js." });
});

const handler = serverless(app);

export default async (req, res) => {
  console.log(`Request received for: ${req.method} ${req.url} (in default export)`);
  try {
    // Any very early request processing or logging can go here
    await handler(req, res); // Pass the request to the serverless-wrapped Express app
  } catch (error) {
    console.error("Unhandled error in the main exported handler:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error in handler." });
    }
  }
};
