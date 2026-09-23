import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './common/database/database.module.js';
import { TemporalModule } from './common/temporal/temporal.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { AmlDetectionModule } from './features/aml-detection/aml-detection.module.js';
import { CorrelationIdMiddleware } from './common/logging/correlation-id.middleware.js';
import { RequestLoggingInterceptor } from './common/logging/request-logging.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    TemporalModule,
    PlatformModule,
    AuthModule,
    AmlDetectionModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // First thing every request hits — every log line for this
    // request, from here through agent-service if it triggers a
    // workflow, carries the same correlation ID.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
