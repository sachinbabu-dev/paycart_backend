import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Response } from 'express';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Preserve the raw request body only for the Stripe webhook path.
    // Stripe signature verification requires the exact bytes Stripe sent —
    // any JSON reserialization breaks the signature.
    rawBody: true,
    bodyParser: false,
  });

  app.use(
    '/webhooks/stripe',
    json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(json({ limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Payment Backend')
    .setDescription(
      'E-commerce order + payments backend. Modular NestJS monolith with Stripe Payment Intents, transactional outbox, and event-driven inventory/notifications.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('auth', 'Signup / login — issues JWTs used by every other endpoint')
    .addTag('orders', 'Order lifecycle — creation, retrieval, event timeline')
    .addTag('payments', 'Stripe checkout (idempotent) and webhook receiver')
    .addTag('inventory', 'Current stock levels — decremented on payment.succeeded')
    .build();

  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

  // Scalar renders the OpenAPI spec as an interactive API reference at /docs.
  // Raw JSON spec is exposed at /docs/json for external tooling (Postman
  // import, code generators, etc.).
  app.use(
    '/docs',
    apiReference({
      spec: { content: openApiDocument },
      theme: 'purple',
    }),
  );
  app
    .getHttpAdapter()
    .get('/docs/json', (_req, res: Response) => res.json(openApiDocument));

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  console.log(`payment-backend listening on :${port}`);
  console.log(`API docs: http://localhost:${port}/docs`);
}

void bootstrap();
