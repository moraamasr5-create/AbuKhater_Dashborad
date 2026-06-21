// safeStorage.js - Quota-protected localStorage wrapper

/**
 * Safely writes to localStorage. Handles QuotaExceededError gracefully.
 * @param {string} key 
 * @param {any} value 
 */
export const safeSetItem = (key, value) => {
  try {
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(key, serializedValue);
  } catch (error) {
    if (isQuotaExceeded(error)) {
      console.warn(`[safeStorage] Quota exceeded when setting key: ${key}. Clearing some caches and retrying...`);
      // Try to clear some known non-critical caches to free up space
      tryToFreeUpSpace();
      
      // Retry once
      try {
        const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, serializedValue);
      } catch (retryError) {
        console.error(`[safeStorage] Retry failed. Could not save ${key} to localStorage.`, retryError);
        // Application will continue working, just without this specific local cache
      }
    } else {
      console.error(`[safeStorage] Error setting key ${key}:`, error);
    }
  }
};

/**
 * Safely reads from localStorage.
 * @param {string} key 
 * @returns {string|null}
 */
export const safeGetItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error(`[safeStorage] Error getting key ${key}:`, error);
    return null;
  }
};

/**
 * Safely removes from localStorage.
 * @param {string} key 
 */
export const safeRemoveItem = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`[safeStorage] Error removing key ${key}:`, error);
  }
};

// Helper function to detect QuotaExceededError
function isQuotaExceeded(e) {
  let quotaExceeded = false;
  if (e) {
    if (e.code) {
      switch (e.code) {
        case 22:
          quotaExceeded = true;
          break;
        case 1014:
          // Firefox
          if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            quotaExceeded = true;
          }
          break;
      }
    } else if (e.number === -2147024882) {
      // Internet Explorer 8
      quotaExceeded = true;
    }
  }
  return quotaExceeded || (e && e.name === 'QuotaExceededError');
}

// Function to clear out old/unimportant keys when quota is reached
function tryToFreeUpSpace() {
  const keysToRemove = [
    'printer_cache', // If we have an explicit key for this, but currently it's dynamic
    // We can iterate and look for specific patterns to clear
  ];
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // Remove any printer caches
      if (key && key.startsWith('printer_cache_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`[safeStorage] Removed ${key} to free up space.`);
    });
  } catch (e) {
    console.warn("[safeStorage] Error trying to free up space", e);
  }
}
