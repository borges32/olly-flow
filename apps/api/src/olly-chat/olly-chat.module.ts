import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { OllyChatConfigService } from './olly-chat-config.service.js';
import { OllyChatController } from './olly-chat.controller.js';
import { OllyChatService } from './olly-chat.service.js';

/** Spec 028: chat da plataforma ("Olly Chat"). */
@Module({
  imports: [AuthModule, CredentialsModule],
  controllers: [OllyChatController],
  providers: [OllyChatService, OllyChatConfigService],
  exports: [OllyChatConfigService],
})
export class OllyChatModule {}
