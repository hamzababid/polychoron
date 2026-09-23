import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
}

/** Holds the current request's correlation ID for the lifetime of
 * that request — every downstream call on the same async chain
 * (services, TypeORM queries, the Winston logger) can read it without
 * it being threaded through every function signature by hand. Set
 * once, in CorrelationIdMiddleware, at the very start of the request. */
class CorrelationIdStore {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }
}

export const correlationIdStore = new CorrelationIdStore();
