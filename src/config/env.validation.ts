import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

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
});
