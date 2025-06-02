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

// Log when the module first loads (once per cold start)
console.log(`[MINIMAL_V2] LOAD - Process PID: ${process.pid}. API Handler (api/index.js) is initializing...`);

app.get("/ping", (req, res) => {
  const requestPath = req.path; // Should be /ping
  console.log(`[MINIMAL_V2] ROUTE ${requestPath} - ENTERED handler`);
  try {
    // Construct the response data BEFORE sending headers/status
    const responsePayload = { message: "Minimal V2 Pong from Vercel!", timestamp: new Date().toISOString() };
    console.log(`[MINIMAL_V2] ROUTE ${requestPath} - PREPARED payload: ${JSON.stringify(responsePayload)}`);

    res.status(200).json(responsePayload); // Send response

    // This log confirms .json() was called.
    console.log(`[MINIMAL_V2] ROUTE ${requestPath} - SUCCESS: res.json() called.`);
  } catch (e) {
    console.error(`[MINIMAL_V2] ROUTE ${requestPath} - ERROR in handler:`, e);
    if (!res.headersSent) {
      try {
        res.status(500).json({ error: "Error in /ping handler" });
      } catch (sendError) {
         console.error(`[MINIMAL_V2] ROUTE ${requestPath} - FAILED to send error JSON:`, sendError);
      }
    }
    console.error(`[MINIMAL_V2] ROUTE ${requestPath} - COMPLETED error handling path.`);
  }
});

app.all('*', (req, res) => {
  const requestPath = req.path;
  console.log(`[MINIMAL_V2] CATCH-ALL ${requestPath} - ENTERED handler for ${req.method} ${req.url}`);
  try {
    const responsePayload = { message: `Route ${req.method} ${req.url} not found in MINIMAL_V2 setup.`, timestamp: new Date().toISOString() };
    console.log(`[MINIMAL_V2] CATCH-ALL ${requestPath} - PREPARED payload: ${JSON.stringify(responsePayload)} for ${req.method} ${req.url}`);

    res.status(404).json(responsePayload);

    console.log(`[MINIMAL_V2] CATCH-ALL ${requestPath} - SUCCESS: res.json() called for ${req.method} ${req.url}`);
  } catch (e) {
    console.error(`[MINIMAL_V2] CATCH-ALL ${requestPath} - ERROR in handler:`, e);
    if (!res.headersSent) {
       try {
        res.status(500).json({ error: "Error in catch-all handler" });
      } catch (sendError) {
         console.error(`[MINIMAL_V2] CATCH-ALL ${requestPath} - FAILED to send error JSON:`, sendError);
      }
    }
    console.error(`[MINIMAL_V2] CATCH-ALL ${requestPath} - COMPLETED error handling path for ${req.method} ${req.url}`);
  }
});

const serverlessAppHandler = serverless(app);
console.log("[MINIMAL_V2] LOAD - serverless(app) wrapper created.");

export default async (req, res) => {
  console.log(`[MINIMAL_V2] EXPORT_DEFAULT - ENTRY: Request received: ${req.method} ${req.url}, Request ID: ${req.headers['x-vercel-id'] || 'N/A'}`);
  try {
    console.log("[MINIMAL_V2] EXPORT_DEFAULT - INVOKING serverlessAppHandler...");
    await serverlessAppHandler(req, res);
    // This log means the await returned, NOT necessarily that the response was fully flushed to the client.
    console.log(`[MINIMAL_V2] EXPORT_DEFAULT - COMPLETED: serverlessAppHandler invocation for ${req.method} ${req.url}, Request ID: ${req.headers['x-vercel-id'] || 'N/A'}`);
  } catch (error) {
    console.error(`[MINIMAL_V2] EXPORT_DEFAULT - CRITICAL ERROR in exported handler for ${req.method} ${req.url}, Request ID: ${req.headers['x-vercel-id'] || 'N/A'}:`, error);
    if (!res.headersSent) {
      try {
        res.status(500).json({ message: "Minimal V2 internal server error in export default." });
      } catch (resError) {
        console.error("[MINIMAL_V2] EXPORT_DEFAULT - FAILED to send error response in critical path:", resError);
      }
    }
  }
};

console.log("[MINIMAL_V2] LOAD - Module script fully parsed.");