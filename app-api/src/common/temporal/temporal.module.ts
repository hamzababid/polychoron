import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';

export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';

/**
 * app-api never runs a Temporal worker and never calls agent-service
 * directly over HTTP for the agent-chain lifecycle — this client is the
 * only integration surface, used to start workflows (alert ingestion)
 * and send signals (disposition -> human checkpoint resume). See
 * specs/platform/09-backend-service-boundary-spec.md.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const address = config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
        const connection = await Connection.connect({ address });
        return new Client({
          connection,
          namespace: config.get<string>('TEMPORAL_NAMESPACE', 'default'),
        });
      },
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalModule {}
