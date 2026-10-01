// Developed & Owned by D.AmrMamdouh - 01038035884
import { useState, useEffect } from 'react';
import { supabase } from './supabase/supabaseClient';
import { supabaseService } from './supabaseService';

export { ReceiptThumbnail } from '../components/common/ReceiptThumbnail';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_DIMENSION = 1200;
const TARGET_KB = 300;

// In-memory cache for generated Signed URLs to minimize storage RPC overhead
const signedUrlCache = new Map();

/**
 * Extracts relative storage path from a full URL, signed URL, or relative path.
 * Returns null for external non-storage URLs (e.g. drive.google.com) or invalid inputs.
 */
export const extractStoragePath = (urlOrPath, bucketName = 'payment-screenshots') => {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;

  const trimmed = urlOrPath.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  // If it's a full URL containing the bucket name
  const bucketMarker = `/${bucketName}/`;
  const markerIndex = trimmed.indexOf(bucketMarker);
  if (markerIndex !== -1) {
    let sub = trimmed.substring(markerIndex + bucketMarker.length);
    // Remove query params (like ?token=... or ?t=...) and hash
    sub = sub.split('?')[0].split('#')[0];
    try {
      return decodeURIComponent(sub);
    } catch {
      return sub;
    }
  }

  // If it starts with http:// or https:// but doesn't contain bucket name, it's external (e.g. Google Drive)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return null;
  }

  // If it's a relative path starting with bucketName/
  if (trimmed.startsWith(`${bucketName}/`)) {
    const sub = trimmed.substring(bucketName.length + 1).split('?')[0].split('#')[0];
    try {
      return decodeURIComponent(sub);
    } catch {
      return sub;
    }
  }

  // Otherwise it's a direct relative path (e.g. "payments/xyz.jpg" or "reservations/abc.png")
  return trimmed.split('?')[0].split('#')[0];
};

/**
 * Generates or retrieves a cached time-limited Signed URL for viewing payment receipts.
 * Accessible to authenticated staff (admin, casher, driver).
 * Falls back to original URL if external or if generation fails.
 */
export const getSignedReceiptUrl = async (urlOrPath, expiresIn = 3600, bucketName = 'payment-screenshots') => {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;

  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;

  // External URLs (Google Drive, data URI, etc.) are returned as-is
  if (trimmed.startsWith('data:') || (trimmed.startsWith('http') && !trimmed.includes(`/${bucketName}/`))) {
    return trimmed;
  }

  const filePath = extractStoragePath(trimmed, bucketName);
  if (!filePath) {
    return trimmed;
  }

  // Check in-memory cache
  const cached = signedUrlCache.get(filePath);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60000) {
    return cached.url;
  }

  if (!supabase) return trimmed;

  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(filePath, expiresIn);

    if (error || !data?.signedUrl) {
      console.warn('[Storage] createSignedUrl failed for:', filePath, error?.message);
      return trimmed;
    }

    // Cache until 5 minutes before actual expiration
    signedUrlCache.set(filePath, {
      url: data.signedUrl,
      expiresAt: now + Math.max((expiresIn - 300) * 1000, 60000)
    });

    return data.signedUrl;
  } catch (err) {
    console.warn('[Storage] Error creating signed URL:', err);
    return trimmed;
  }
};

/**
 * React hook to asynchronously resolve a signed URL for a receipt path/URL.
 */
export const useSignedReceiptUrl = (urlOrPath, expiresIn = 3600) => {
  const [signedUrl, setSignedUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(urlOrPath));
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    if (!urlOrPath) {
      setSignedUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    getSignedReceiptUrl(urlOrPath, expiresIn)
      .then((resolved) => {
        if (isMounted) {
          setSignedUrl(resolved);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('[useSignedReceiptUrl] Error:', err);
          setError(err);
          setSignedUrl(urlOrPath);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [urlOrPath, expiresIn]);

  return { signedUrl, isLoading, error };
};

/**
 * Compresses an image file to JPEG blob (max ~300KB).
 */
export const compressImageFile = (file) => {
  if (!file) return Promise.resolve(null);
  if (file.size > MAX_FILE_SIZE) {
    alert('حجم الصورة كبير جداً (أقصى حجم 5MB).');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        let quality = 0.6;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        const getKbSize = (base64String) => (base64String.length * 0.75) / 1024;

        while (getKbSize(dataUrl) > TARGET_KB && quality > 0.1) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        fetch(dataUrl)
          .then(res => res.blob())
          .then(blob => resolve(blob))
          .catch(() => resolve(null));
      };
      img.onerror = () => resolve(null);
      img.src = event.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

/**
 * Uploads a blob to Supabase Storage and returns the public URL or relative path.
 */
export const uploadPaymentImage = async (
  blob,
  { bucketName = 'payment-screenshots', folderPath = 'orders' } = {}
) => {
  if (!blob || !navigator.onLine || !supabase) return null;

  const fileName = `${folderPath}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

  if (error || !data) {
    console.error('[Storage] Upload failed:', error);
    return null;
  }

  const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
  return publicUrlData?.publicUrl || fileName;
};

/**
 * Uploads receipt image for an existing order row, then updates payment_screenshot.
 * Order row must already exist — call only after createManualOrder returns an id.
 */
export const attachReceiptToOrder = async (orderSupabaseId, file, skipQueue = false) => {
  if (!orderSupabaseId || !file) return null;

  const blob = await compressImageFile(file);
  if (!blob) throw new Error('Image compression failed');

  const publicUrl = await uploadPaymentImage(blob, {
    folderPath: `orders/${orderSupabaseId}`
  });
  if (!publicUrl) throw new Error('Storage upload failed');

  await supabaseService.updateOrderPaymentScreenshot(orderSupabaseId, publicUrl, skipQueue);
  return publicUrl;
};

/**
 * Compress + upload for reservations (no order row update).
 */
export const uploadReservationReceipt = async (file, skipQueue = false) => {
  const blob = await compressImageFile(file);
  if (!blob) return null;
  return uploadPaymentImage(blob, { folderPath: 'reservations' });
};
