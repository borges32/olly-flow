import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reaproveita um `x-request-id` válido do cliente ou gera um novo. */
function requestId(req: IncomingMessage | Http2ServerRequest): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  // O Fastify gera o id antes dos middlewares; o pino-http o lê deste cabeçalho.
  req.headers['x-request-id'] = id;
  return id;
}

export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ genReqId: requestId }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });

  if (config.env === 'development') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Olly Flow API').setVersion('1').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
