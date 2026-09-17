import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformRole, PlatformSession, PlatformUser } from '../entities/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  // PlatformRole has no dedicated service of its own yet — its
  // repository is registered here (rather than a new module) purely
  // so scripts/seed-demo-users.ts can reach it via the Nest DI
  // container; revisit if/when a real role-management concern needs it.
  imports: [TypeOrmModule.forFeature([PlatformUser, PlatformSession, PlatformRole])],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [TypeOrmModule],
})
export class AuthModule {}
