import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, tap, throwError } from 'rxjs';
import type { PlatformUser } from '../../platform/entities/index.js';

/** One access-log line per request — method, path, status, duration,
 * acting user if the route is authenticated. This is the single
 * uniform hook that gives every route e2e traceability without
 * hand-instrumenting each controller; correlationId is stamped onto
 * every line automatically by the Winston logger (see
 * winston.config.ts), not passed here. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request & { currentUser?: PlatformUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    const logCompletion = (statusCode: number) => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const userId = req.currentUser?.userId ?? 'anonymous';
      this.logger.log(`${req.method} ${req.originalUrl} ${statusCode} ${durationMs.toFixed(1)}ms user=${userId}`);
    };

    return next.handle().pipe(
      tap(() => logCompletion(res.statusCode)),
      catchError((err: unknown) => {
        const statusCode = (err as { status?: number })?.status ?? 500;
        logCompletion(statusCode);
        return throwError(() => err);
      }),
    );
  }
}
