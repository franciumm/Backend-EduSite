import { globalerrorHandling } from './utils/erroHandling.js';
import cors from 'cors';
import auth from './auth/auth.router.js';
import group from "./Modules/Groups/Group.router.js";
import assg from './Modules/Assignments/Assg.router.js';
import exam  from './Modules/Exams/Exams.router.js';
import mater from "./Modules/Materials/Materials.router.js";
// Make sure you import requestTimeout here!
import { requestTimeout } from './middelwares/requestTimeout.js'; 
import DBConnect from '../DB/DB.Connect.js';

const bootstrape = async (app, express) => {
    await DBConnect();
    // --- 2. Global Middlewares (apply to every request) ---
    // CORS Configuration: Use your whitelist properly.
    const whitelist = ["http://127.0.0.1:5500" , "http://localhost:3000"]; // Example: Add your frontend dev server
    app.use(cors({
        origin: function (origin, callback) {
            // Allow requests with no origin (like Postman or server-to-server)
            if (!origin || whitelist.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
    }));
    
    // Body Parsers
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    
    // Global Request Timeout: Protects all subsequent routes.
    app.use(requestTimeout(15000)); // Using 15s as a safe global default

    // --- 3. Routers (Define all your API endpoints) ---
    app.use('/group', group);
    app.use('/exams', exam);
    app.use("/assignments", assg);
    app.use('/student', auth);
    app.use('/material', mater);

    // --- 4. Invalid Route Handler (404 Not Found) ---
    // This runs ONLY if the request URL didn't match any of the routers above.
    app.use('*', (req, res, next) => {
        return res.status(404).json({ message: 'In-Valid Routing: Route not found' });
    });

    // --- 5. Global Error Handler ---
    // This MUST be the last middleware. It catches all errors thrown by previous
    // middlewares and routers (e.g., from an asyncHandler).
    app.use(globalerrorHandling);
};

export default bootstrape;