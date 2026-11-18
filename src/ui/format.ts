import type { AppModel } from '../app/model';

/** "SUI 07": nation code + zero-padded bib, the short athlete name used throughout the UI. */
export const athleteLabel = (model: AppModel, bib: number): string => `${model.info(bib).nation} ${String(bib).padStart(2, '0')}`;
