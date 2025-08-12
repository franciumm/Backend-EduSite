import { Router } from 'express';
import os from 'os';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      hostname: os.hostname(),
      reqId: req.id,
    },
  });
});

export default router;