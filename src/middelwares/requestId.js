import { randomUUID } from 'crypto';

export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.set('x-request-id', req.id);
  next();
}