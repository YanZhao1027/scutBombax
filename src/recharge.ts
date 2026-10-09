import type { Campus } from './types';

/** Refuse the DXC-only payment link on GZIC, including expired or unknown sessions. */
export const rechargeCampus = (
  sessionCampus: Campus | null,
  selectedCampus: Campus
): Campus => sessionCampus ?? selectedCampus;

export const rechargeAvailable = (
  sessionCampus: Campus | null,
  selectedCampus: Campus
): boolean => rechargeCampus(sessionCampus, selectedCampus) === 'DXC';
