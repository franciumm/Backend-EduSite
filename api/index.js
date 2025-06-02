// api/index.js
import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import bootstrape from "../src/index.router.js"; // adjust path if needed

dotenv.config();

const app = express();

// (1) Register your routes/middleware BEFORE exporting
bootstrape(app, express);

app.get("/", (req, res) => {
  res.json({ message: "Hello from Vercel!" });
});

// (2) Wrap in serverless()
const handler = serverless(app);

// (3) Export as the default
export default handler;
