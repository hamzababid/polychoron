import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './common/database/database.module.js';
import { TemporalModule } from './common/temporal/temporal.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { AuthModule } from './platform/auth/auth.module.js';
import { AmlDetectionModule } from './features/aml-detection/aml-detection.module.js';

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
  providers: [AppService],
})
export class AppModule {}
