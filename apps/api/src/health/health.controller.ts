import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@olly/shared-types';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

@ApiTags('saúde')
@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** FR-012: estado do banco e do Redis (e do IdP, que apenas degrada). */
  @ApiOperation({ summary: 'Estado da API e das dependências' })
  @Public()
  @Get('health')
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const result = await this.health.check();
    void reply.status(result.status === 'error' ? 503 : 200);
    return result;
  }
}
