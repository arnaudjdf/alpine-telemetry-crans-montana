import type { AthleteInfo } from '../core/packet';

/** Fictional athletes: physical parameters drive the simulation, never real people. */
export interface AthleteProfile extends Omit<AthleteInfo, 'file' | 'startEpoch'> {
  mass: number;       // kg incl. equipment
  cda: number;        // drag area in tuck, m^2
  mu: number;         // snow friction coefficient
  lineGain: number;   // 1 = takes the gates tight, <1 = rounder/safer line
  seed: number;
}

export const ATHLETES: AthleteProfile[] = [
  { bib: 7,  name: 'Athlete 07', nation: 'SUI', color: '#ff7a1a', src: 'LLAD-07', mass: 93, cda: 0.206, mu: 0.0284, lineGain: 0.95, seed: 7 },
  { bib: 12, name: 'Athlete 12', nation: 'AUT', color: '#38bdf8', src: 'LLAD-12', mass: 91, cda: 0.210, mu: 0.0282, lineGain: 0.90, seed: 12 },
  { bib: 21, name: 'Athlete 21', nation: 'NOR', color: '#a3e635', src: 'LLAD-21', mass: 95, cda: 0.208, mu: 0.0290, lineGain: 1.00, seed: 21 },
  { bib: 33, name: 'Athlete 33', nation: 'FRA', color: '#f472b6', src: 'LLAD-33', mass: 89, cda: 0.212, mu: 0.0278, lineGain: 0.85, seed: 33 },
];
