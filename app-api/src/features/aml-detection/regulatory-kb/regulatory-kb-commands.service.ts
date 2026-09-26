import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ApplicationFailure,
  Client,
  TimeoutFailure,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
} from '@temporalio/client';
import { TEMPORAL_CLIENT } from '../../../common/temporal/temporal.module.js';

export const KB_FEATURE_CODE = 'aml_detection';
const TASK_QUEUE = 'aml_detection-task-queue';
const COMMAND_TIMEOUT = '30s';

export type KbCommand =
  | 'RegulatoryExtractCommand'
  | 'RegulatoryChunkPreviewCommand'
  | 'RegulatoryDraftCommand'
  | 'RegulatoryPublishCommand'
  | 'RegulatoryMetadataCommand'
  | 'RegulatoryRetrievalPreviewCommand';

export type KbJobWorkflow = 'RegulatoryEmbedDraftWorkflow' | 'RegulatoryReembedWorkflow';

/** specs/platform/10-regulatory-knowledge-base-spec.md, "Pipeline — one
 * background job, everything else awaited".
 *
 * agent-service owns writes to the KB tables and app-api reaches it only
 * through Temporal (spec 09). None of the commands is slow, so each runs
 * as a short workflow awaited inside the HTTP request — no job id, no
 * polling. Business-rule failures come back as an ApplicationFailure
 * whose `type` is Conflict / NotFound / Invalid / TooLarge
 * (agent-service commands.py) and map to 409 / 404 / 400 / 413.
 *
 * Only embedding is a background job (startJob), because it makes one
 * embeddings call per chunk. */
@Injectable()
export class RegulatoryKbCommandsService {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client) {}

  /** `onceKey` makes the workflow id deterministic, so a concurrent
   * duplicate (e.g. a double-clicked Publish) is rejected by Temporal
   * and surfaces as 409 instead of running twice. */
  async run<T>(command: KbCommand, payload: Record<string, unknown>, onceKey?: string): Promise<T> {
    const workflowId = onceKey ? `kb-${onceKey}` : `kb-cmd-${randomUUID()}`;
    try {
      return (await this.temporalClient.workflow.execute(command, {
        taskQueue: TASK_QUEUE,
        workflowId,
        workflowExecutionTimeout: COMMAND_TIMEOUT,
        args: [{ feature_code: KB_FEATURE_CODE, ...payload }],
      })) as T;
    } catch (err) {
      throw toHttpException(err);
    }
  }

  async startJob(workflow: KbJobWorkflow, documentId: string): Promise<{ jobId: string }> {
    const prefix = workflow === 'RegulatoryEmbedDraftWorkflow' ? 'regulatory-embed' : 'regulatory-reembed';
    const jobId = `${prefix}-${randomUUID()}`;
    await this.temporalClient.workflow.start(workflow, {
      taskQueue: TASK_QUEUE,
      workflowId: jobId,
      args: [{ document_id: documentId }],
    });
    return { jobId };
  }
}

export function toHttpException(err: unknown): HttpException {
  if (err instanceof HttpException) return err;
  if (err instanceof WorkflowExecutionAlreadyStartedError) {
    return new ConflictException('This action is already in progress for this document.');
  }
  if (err instanceof WorkflowFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure) {
      const details = (cause.details?.[0] ?? {}) as Record<string, unknown>;
      const body = { message: cause.message, ...details };
      switch (cause.type) {
        case 'Conflict':
          return new ConflictException(body);
        case 'NotFound':
          return new NotFoundException(body);
        case 'Invalid':
          return new BadRequestException(body);
        case 'TooLarge':
          return new PayloadTooLargeException(body);
      }
      return new InternalServerErrorException(cause.message);
    }
    if (cause instanceof TimeoutFailure) {
      return new GatewayTimeoutException('The knowledge-base service took too long to respond — try again.');
    }
    return new InternalServerErrorException(cause?.message ?? err.message);
  }
  return new InternalServerErrorException(err instanceof Error ? err.message : String(err));
}
