import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module.js';
import { createWinstonLogger } from './common/logging/winston.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({ instance: createWinstonLogger() }),
  });
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
