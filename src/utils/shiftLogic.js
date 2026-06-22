// src/utils/shiftLogic.js

/**
 * Utility functions for precise business logic and time normalization.
 * Fixes the 20-hour shift bug (8:00 AM to 4:00 AM) and delay latency issues.
 * MAX_SHIFT_MINUTES: أقصي وقت شيفت طيار = 12 ساعة (720 دقيقة)
 */

import {
  getCairoMinutesOfDay,
  getCairoDateString,
  parseTimeToMinutes,
  isAutoCloseTimeNow,
  DEFAULT_SHIFT_OPEN_TIME,
  DEFAULT_SHIFT_CLOSE_TIME
} from './shiftGovernance';

// أقصي مدة شيفت طيار = 12 ساعة = 720 دقيقة
export const MAX_SHIFT_MINUTES = 12 * 60; // 720

// Cap total pilot minutes to the maximum allowed shift duration
export const capShiftMinutes = (minutes) => {
  return Math.min(minutes, MAX_SHIFT_MINUTES);
};

// Normalize all current times to avoid client-server discrepancies
export const getNormalizedDate = (dateString) => {
  return dateString ? new Date(dateString) : new Date();
};

export const getNormalizedNow = () => {
  return new Date();
};

// Calculates the "Logical Business Day" for the shift (Africa/Cairo).
// Real day vs Shift Day: a shift opened at the configured open time and running
// past midnight belongs to the calendar day on which it opened.
// The boundary is driven by the DB-controlled shift open time so a change in
// the settings applies everywhere without touching the code.
export const getLogicalShiftDateString = (openTime = DEFAULT_SHIFT_OPEN_TIME) => {
  const now = getNormalizedNow();
  const openMinutes = parseTimeToMinutes(openTime) ?? parseTimeToMinutes(DEFAULT_SHIFT_OPEN_TIME);
  const curMinutes = getCairoMinutesOfDay(now);

  // Before the open time (Cairo) we are still inside the previous operational day.
  if (curMinutes < openMinutes) {
    const previous = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return getCairoDateString(previous);
  }
  return getCairoDateString(now);
};

// Calculate Delay in Minutes Safely (Latency Bug Fix)
export const calculateDelayMinutes = (startTime, endTime = null) => {
  if (!startTime) return 0;
  try {
    const start = getNormalizedDate(startTime).getTime();
    const end = endTime ? getNormalizedDate(endTime).getTime() : getNormalizedNow().getTime();
    
    // Prevent negative latency race conditions
    const diffMs = Math.max(0, end - start);
    return Math.floor(diffMs / (1000 * 60));
  } catch(e) {
    return 0;
  }
};

// Calculate time cleanly in ISO format
export const getSafeISOTime = () => {
    return getNormalizedNow().toISOString();
};

// Verify if the current time dictates an auto-close of the shift.
// Driven by the DB-controlled close time, evaluated in Africa/Cairo.
export const isAutoCloseTime = (closeTime = DEFAULT_SHIFT_CLOSE_TIME) => {
  return isAutoCloseTimeNow(closeTime, getNormalizedNow());
};

export const generateSafeId = (prefix) => {
    // Adding random to ensure uniqueness in fast clicks
    const randomSuffix = Math.floor(Math.random() * 10000);
    return `${prefix}-${getNormalizedNow().getTime()}-${randomSuffix}`;
};

export const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};
