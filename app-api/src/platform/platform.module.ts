import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Feature, Suite } from './entities/index.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

/**
 * The platform navigation shell's backing data — the suite/feature
 * registry. Today this returns exactly one suite (bfsi) with one
 * feature (aml_detection), but the shell's frontend renders it as a
 * list either way, so adding a second suite/feature later is a data
 * change, not a UI rewrite (specs/platform/01-platform-architecture.md).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Suite, Feature])],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
