import { Controller, Get } from '@nestjs/common';
import { PlatformService, type SuiteWithFeatures } from './platform.service.js';

/**
 * Backs the navigation shell's suite switcher / feature switcher
 * (specs/platform/01-platform-architecture.md). Not part of any
 * feature's own API contract — this is platform-owned, unnamespaced
 * (see api-contracts-phase1.md's note that platform routes aren't
 * namespaced under a feature).
 */
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('suites')
  async listSuites(): Promise<SuiteWithFeatures[]> {
    return this.platformService.listSuitesWithFeatures();
  }
}
