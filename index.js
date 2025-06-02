import express  from "express"
import bootstrape from "./src/index.router.js";
import serverless  from "serverless-http"
import dotenv from 'dotenv'
dotenv.config();
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello from Vercel!" });
});

export const handler = serverless(app);

bootstrape(app,express);
