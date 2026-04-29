import { environment } from '../../environments/environment';

const enabled = !environment.production;

export const logger = {
  debug: (...args: any[]) => { if (enabled) console.debug(...args); },
  info: (...args: any[]) => { if (enabled) console.info(...args); },
  warn: (...args: any[]) => { console.warn(...args); },
  error: (...args: any[]) => { console.error(...args); }
};
