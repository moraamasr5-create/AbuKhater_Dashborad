// Developed & Owned by D.AmrMamdouh - 01038035884
import { supabase } from './supabase/supabaseClient';
import { supabaseService } from './supabaseService';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_DIMENSION = 1200;
const TARGET_KB = 300;

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
 * Uploads a blob to Supabase Storage and returns the public URL.
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
  return publicUrlData?.publicUrl || null;
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
