/**
 * Trip detection now lives in @nook/core so web and mobile share one
 * implementation. Re-exported here to keep existing import paths working.
 */
export { detectTrips, detectHome, tripTitle, type Trip } from '@nook/core';
