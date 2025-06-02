// import express from "express";
// import serverless from "serverless-http";
// import dotenv from "dotenv";
// import bootstrape from "../src/index.router.js"; // Ensure this path is correct!

// // Load environment variables locally if not in production
// if (process.env.NODE_ENV !== 'production') {
//   dotenv.config();
// }

// const app = express();

// console.log("API Handler (api/index.js) starting...");
// try {
//   bootstrape(app, express); console.log("Bootstrap function executed successfully.");
// } catch (error) {
//   console.error("Error during bootstrap execution:", error);
// }
// app.get("/ping", (req, res) => {
//   console.log("Request received for /ping route in api/index.js");
//   res.status(200).json({ message: "Pong! Service is alive from api/index.js." });
// });

// const handler = serverless(app);

// export default async (req, res) => {
//   console.log(`Request received for: ${req.method} ${req.url} (in default export)`);
//   try {
//     // Any very early request processing or logging can go here
//     await handler(req, res); // Pass the request to the serverless-wrapped Express app
//   } catch (error) {
//     console.error("Unhandled error in the main exported handler:", error);
//     if (!res.headersSent) {
//       res.status(500).json({ message: "Internal server error in handler." });
//     }
//   }
// };



// api/index.js
import express from "express";
import serverless from "serverless-http";

const app = express();

// Unique log to confirm this version is running
console.log("[ULTRA-MINIMAL] API Handler (api/index.js) is starting...");

app.get("/ping", (req, res) => {
  console.log("[ULTRA-MINIMAL] Request received for /ping route");
  // Immediately send a response
  res.status(200).json({ message: "Ultra-Minimal Pong from Vercel!" });
  console.log("[ULTRA-MINIMAL] Response sent for /ping route");
});

// A catch-all for any other route requests to see if they even reach here
app.all('*', (req, res) => {
  console.log(`[ULTRA-MINIMAL] Unhandled route hit: ${req.method} ${req.url}`);
  res.status(404).json({ message: `Route ${req.method} ${req.url} not found in ultra-minimal setup.` });
});

const serverlessAppHandler = serverless(app);

export default async (req, res) => {
  console.log(`[ULTRA-MINIMAL] Vercel exported handler received request: ${req.method} ${req.url}`);
  try {
    console.log("[ULTRA-MINIMAL] About to call serverlessAppHandler...");
    await serverlessAppHandler(req, res);
    console.log("[ULTRA-MINIMAL] Call to serverlessAppHandler completed.");
  } catch (error) {
    console.error("[ULTRA-MINIMAL] Error in Vercel exported handler:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Ultra-Minimal internal server error." });
    }
  }
};