import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module.js';
import { createWinstonLogger } from './common/logging/winston.config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger({ instance: createWinstonLogger() }),
  });
  // Regulatory KB: a pasted regulation or a full chunk list can exceed
  // Express's 100 kb default. The endpoints themselves cap content at
  // 1.5 MB (it has to fit a Temporal payload); 2 mb leaves JSON overhead.
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  // Mounted outside the versioned /api/v1 prefix — it documents that
  // prefix's routes, but the docs UI itself isn't part of the
  // versioned API surface.
  const swaggerDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Polychoron AI — app-api')
      .setDescription(
        'Screen-facing REST API for the AML Detection feature (BFSI suite). ' +
          'Session auth via the x-session-id header (see POST /api/v1/auth/demo-login) — ' +
          'use "Authorize" below with a session ID from that endpoint.',
      )
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'x-session-id', in: 'header' }, 'session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, swaggerDoc);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
