import type { en } from '../en/index.js';
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
import { campaigns } from './campaigns.js';
import { notes } from './notes.js';
import { sessionLog } from './sessionLog.js';
import { assets } from './assets.js';
import { dice } from './dice.js';
import { landing } from './landing.js';

export const fr = {
  common, login, register, dashboard, nav, hp, proficiency, effects, hpAdjust, upload,
  campaigns, notes, sessionLog, assets, dice, landing,
} satisfies typeof en;
