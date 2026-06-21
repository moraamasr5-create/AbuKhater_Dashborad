// src/utils/shiftLogic.js

/**
 * Utility functions for precise business logic and time normalization.
 * Fixes the 20-hour shift bug (8:00 AM to 4:00 AM) and delay latency issues.
 * MAX_SHIFT_MINUTES: أقصي وقت شيفت طيار = 12 ساعة (720 دقيقة)
 */

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

// Calculates the "Logical Business Day" for the shift
// Real day vs Shift Day: A shift from 8 AM today to 4 AM tomorrow belongs to "today".
export const getLogicalShiftDateString = () => {
  const now = getNormalizedNow();
  let shiftDate = new Date(now);
  
  // If before 8 AM, it logically belongs to the *previous* calendar day
  if (now.getHours() < 8) {
    shiftDate.setDate(shiftDate.getDate() - 1);
  }
  
  const year = shiftDate.getFullYear();
  const month = String(shiftDate.getMonth() + 1).padStart(2, '0');
  const day = String(shiftDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

// Verify if the current time dictates an auto-close of the shift
export const isAutoCloseTime = () => {
  const now = getNormalizedNow();
  // Valid closing window: Between 4:00 AM and 7:59 AM we are in "closed" state.
  return now.getHours() >= 4 && now.getHours() < 8; 
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
