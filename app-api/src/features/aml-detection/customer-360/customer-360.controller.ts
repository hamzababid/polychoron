import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Customer360Service, type Customer360Response } from './customer-360.service.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

const READ_ROLES = ['aml_detection.analyst_l1', 'aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/08-customer-360.md
 * Read-only by construction — this controller defines no write routes. */
@ApiTags('Customer 360')
@Controller('features/aml_detection/customers')
@UseGuards(SessionGuard, RolesGuard)
export class Customer360Controller {
  constructor(private readonly customer360Service: Customer360Service) {}

  @RequireRoles(...READ_ROLES)
  @Get(':customerId/360')
  async get(@Param('customerId') customerId: string): Promise<Customer360Response> {
    return this.customer360Service.getCustomer360(customerId);
  }
}
