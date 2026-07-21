import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // Optional bootstrap superadmin — seeded once on startup if no superadmin
  // exists. Both must be set together; either alone is a config mistake.
  SUPERADMIN_EMAIL: Joi.string().email().optional(),
  SUPERADMIN_PASSWORD: Joi.string()
    .min(8)
    .when('SUPERADMIN_EMAIL', {
      is: Joi.exist(),
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),

  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),

  // REDIS_URL is only required when the redis event bus driver is selected;
  // the default in-process driver has no Redis dependency.
  EVENT_BUS_DRIVER: Joi.string().valid('memory', 'redis').default('memory'),
  REDIS_URL: Joi.string()
    .uri()
    .when('EVENT_BUS_DRIVER', {
      is: 'redis',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().default(1000),

  // Simulated warehouse fulfillment. After payment succeeds, the order goes
  // to `preparing` immediately, then to `shipped` once it has been in
  // `preparing` for this many seconds. Poll interval should be >= the outbox
  // interval to avoid two timers stampeding on wake.
  FULFILLMENT_PREPARING_DELAY_SECONDS: Joi.number().default(10),
  FULFILLMENT_POLL_INTERVAL_MS: Joi.number().default(2000),

  // Optional. If set, /.well-known/apple-developer-merchantid-domain-association
  // returns this string as text/plain — that's what Stripe polls to verify
  // your domain for Apple Pay. If unset, the endpoint 404s.
  APPLE_PAY_DOMAIN_ASSOCIATION: Joi.string().optional().allow(''),
});
