import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MeResponse } from '@olly/shared-types';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Authenticated } from '../auth/public.decorator.js';

@ApiTags('usuários')
@ApiBearerAuth()
@Controller()
export class MeController {
  /** FR-006 (spec 001) e FR-010 (spec 002): usuário e permissões globais e por projeto. */
  @ApiOperation({ summary: 'Usuário autenticado e permissões efetivas' })
  @Authenticated()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): MeResponse {
    return { id: user.id, email: user.email, name: user.name, permissions: user.permissions };
  }
}
