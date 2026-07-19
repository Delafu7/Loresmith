// Module augmentation: our only piece of session state is the logged-in
// user's id. Everything else about the user is loaded fresh from Postgres
// per-request by requireAuth (see src/middleware/auth.ts).

import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}
