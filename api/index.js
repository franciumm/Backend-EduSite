import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import DBConnect from '../DB/DB.Connect.js';
import bootstrape from '../src/index.router.js';   // keep your original router bootstrap
import { requestId } from '../src/middelwares/requestId.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
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