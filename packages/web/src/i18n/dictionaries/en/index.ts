// English — the canonical dictionary, assembled from one file per screen/
// component domain (common.ts, login.ts, dashboard.ts, ...) rather than one
// giant object literal, specifically so independent translation passes can
// each own a couple of new files without ever touching this one or each
// other's. es/index.ts and fr/index.ts are checked against this shape via
// `satisfies typeof en`, so a key added here that's missing elsewhere is a
// compile error, not a silent runtime fallback discovered later.
//
// Not every screen has a section yet — t() falls back to the English string
// (or the raw key, as a last resort; see ../../LocaleContext.tsx) for
// anything not yet in the dictionaries, so an untranslated screen degrades
// gracefully instead of breaking.
import { common } from './common.js';
import { login } from './login.js';
import { register } from './register.js';
import { dashboard } from './dashboard.js';
import { nav } from './nav.js';
import { hp } from './hp.js';
import { proficiency } from './proficiency.js';
import { effects } from './effects.js';
import { hpAdjust } from './hpAdjust.js';
import { upload } from './upload.js';

export const en = { common, login, register, dashboard, nav, hp, proficiency, effects, hpAdjust, upload };
