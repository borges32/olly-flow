import { Global, Module } from '@nestjs/common';
import { MaskingService } from './masking.service.js';

/** Serviço de mascaramento (spec 009), compartilhado pela API e pelo worker. */
@Global()
@Module({ providers: [MaskingService], exports: [MaskingService] })
export class MaskingModule {}
