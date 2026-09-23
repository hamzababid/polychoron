import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { correlationIdStore } from './correlation-id.store.js';

const HEADER = 'x-correlation-id';

/** First thing every request hits (applied in AppModule.configure,
 * before routing). Honors an inbound x-correlation-id if the caller
 * already has one (e.g. a future gateway, or a manual curl for
 * debugging a specific trace), otherwise mints one — and always
 * echoes it back on the response so the caller can correlate their
 * own logs against ours. */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const correlationId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
    res.setHeader(HEADER, correlationId);
    correlationIdStore.run({ correlationId }, () => next());
  }
}
