import * as winston from 'winston';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import { correlationIdStore } from './correlation-id.store.js';

const LOG_DIR = process.env.LOG_DIR ?? 'logs';
const LOG_FILE = path.join(LOG_DIR, 'app-api.log');

// winston's File transport doesn't create parent directories itself.
fs.mkdirSync(LOG_DIR, { recursive: true });

/** Stamps the current request's correlation ID (see
 * correlation-id.store.ts) onto every log line automatically — a
 * caller never passes it explicitly, so it can't be forgotten on a
 * one-off log statement the way a manually-threaded parameter can. */
const withCorrelationId = winston.format((info) => {
  const correlationId = correlationIdStore.getCorrelationId();
  if (correlationId) info.correlationId = correlationId;
  return info;
});

/** Console: human-readable, colorized, close to Nest's own default
 * formatting so local `npm run start:dev` / `docker logs` output
 * doesn't get harder to read. File: one JSON object per line — meant
 * to be grepped/parsed by correlationId to reconstruct one request's
 * full story, not read by eye. Both are always on; there is no
 * "logging disabled" mode, since the audit-of-record
 * (platform_agent_activity_log) is a separate, non-negotiable
 * mechanism this doesn't replace — this is operational tracing only. */
export function createWinstonLogger() {
  return winston.createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    format: winston.format.combine(withCorrelationId(), winston.format.timestamp()),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
          winston.format.colorize({ all: true }),
          nestWinstonModuleUtilities.format.nestLike('app-api', { prettyPrint: true, colors: true }),
        ),
      }),
      new winston.transports.File({
        filename: LOG_FILE,
        format: winston.format.json(),
        maxsize: 10 * 1024 * 1024, // 10MB per file
        maxFiles: 5, // ~50MB retained, rotated oldest-first
        tailable: true,
      }),
    ],
  });
}
