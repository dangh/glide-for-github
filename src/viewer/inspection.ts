/** Inspection hooks live in Chrome's isolated world, inaccessible to GitHub page scripts. */
import { useSettings } from './state/settings';
import { usePr } from './state/store';
import { session } from './state/session';
import * as review from './state/review';
import { useFileGroups } from './state/fileGroups';
import { useRelatedRules } from './state/relatedFiles';

const inspection = { store: usePr, settings: useSettings, session, review, fileGroups: useFileGroups, relatedRules: useRelatedRules };
declare global {
  interface Window { __pierre?: typeof inspection; }
}
window.__pierre = inspection;
