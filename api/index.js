import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import DBConnect from '../DB/DB.Connect.js';
import bootstrape from '../src/index.router.js';   // keep your original router bootstrap
import { requestId } from '../src/middelwares/requestId.js';
const whitelist = [
    'http://localhost:3000',      // Your local development machine
    'https://adel225.github.io/EduSite/' // Your specific Vercel frontend URL
].filter(Boolean);

// 2. We create a set of "Rules" for the bouncer
const corsOptions = {
  // Rule #1: The Origin Logic
  origin: function (origin, callback) {
    // If the request has no origin (like Postman) OR its origin is on our guest list...
    if (!origin || whitelist.indexOf(origin) !== -1) {
      // ...then allow the request.
      callback(null, true);
    } else {
      // ...otherwise, block it.
      callback(new Error('Not allowed by CORS'));
    }
  },
  // Rule #2: Allow Credentials
  credentials: true, 
};
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestId);
app.use(morgan(':method :url :status - :response-time ms - reqId=:req[id]'));

await DBConnect(); 


app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', reqId: req.id } });
});
bootstrape(app, express);
export default app;