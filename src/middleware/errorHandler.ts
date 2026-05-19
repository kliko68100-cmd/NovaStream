import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error({ err: err.message, path: req.path, method: req.method }, 'Erreur non gérée');

  res.status(500).json({
    error: 'Erreur serveur interne',
    ...(process.env.NODE_ENV !== 'production' && { message: err.message, stack: err.stack }),
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
}
