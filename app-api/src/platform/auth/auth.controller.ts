import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService, type DemoSessionResponse } from './auth.service.js';
import { DemoLoginDto } from './dto/demo-login.dto.js';

/** Platform-owned, unnamespaced route — not under any feature's
 * /features/<code>/ prefix (api-contracts-phase1.md). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('demo-login')
  async demoLogin(@Body() dto: DemoLoginDto): Promise<DemoSessionResponse> {
    return this.authService.demoLogin(dto.user_id);
  }
}
