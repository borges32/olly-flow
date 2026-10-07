import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthConfig, LocalSessionResponse } from '@olly/shared-types';
import { PASSWORD_MAX_LENGTH } from '@olly/shared-types';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AuthenticatedUser } from './auth.types.js';
import { CurrentUser, type RequestWithUser } from './current-user.decorator.js';
import { LocalAuthService } from './local-auth.service.js';
import { Authenticated, Public } from './public.decorator.js';

const password = z
  .string()
  .min(1)
  .max(PASSWORD_MAX_LENGTH * 4);
const email = z.email().max(320);
const setupSchema = z.object({ name: z.string().trim().min(1).max(200), email, password }).strict();
const loginSchema = z.object({ email: z.string().max(320), password }).strict();
const changeSchema = z.object({ currentPassword: password, newPassword: password }).strict();

const ip = (req: RequestWithUser) => req.ip || null;

/**
 * Primeiro usuário e login local (spec 014). As rotas públicas não revelam se um e-mail existe;
 * o tamanho máximo da senha no corpo limita o custo do hash.
 */
@ApiTags('autenticação')
@Controller('auth')
export class LocalAuthController {
  constructor(@Inject(LocalAuthService) private readonly auth: LocalAuthService) {}

  /** FR-001/FR-010: cadastro do primeiro usuário pendente e IdP ativado. */
  @Public()
  @Get('config')
  config(): Promise<AuthConfig> {
    return this.auth.authConfig();
  }

  /** FR-001 a FR-003: aceito uma única vez; o usuário já sai com a sessão aberta. */
  @Public()
  @Post('setup')
  setup(
    @Req() req: RequestWithUser,
    @Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>,
  ): Promise<LocalSessionResponse> {
    return this.auth.setup(body, ip(req));
  }

  /** FR-004/FR-005: login com e-mail e senha. */
  @Public()
  @HttpCode(200)
  @Post('local/login')
  login(
    @Req() req: RequestWithUser,
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
  ): Promise<LocalSessionResponse> {
    return this.auth.login(body, ip(req));
  }

  @ApiBearerAuth()
  @Authenticated()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: RequestWithUser, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logout(user, ip(req));
  }

  /** FR-007: troca da própria senha (também a troca obrigatória do primeiro acesso). */
  @ApiBearerAuth()
  @Authenticated()
  @HttpCode(204)
  @Put('password')
  async changePassword(
    @Req() req: RequestWithUser,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>,
  ): Promise<void> {
    await this.auth.changePassword(user, body, ip(req));
  }
}
