// Shared Redis client, used for express-session storage via connect-redis.
// REDIS_URL is loaded from the repo-root .env the same way DATABASE_URL is.

import { createClient } from 'redis';

const url = process.env.REDIS_URL;
if (!url) {
  throw new Error('REDIS_URL is not set (expected to be loaded from the repo-root .env)');
}

export const redisClient = createClient({ url });

redisClient.on('error', (err) => {
  console.error('[redis] Client error', err);
});
