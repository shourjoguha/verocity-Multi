// Meal photo storage. Storage lives here, not in queries.ts, which is
// PostgREST row CRUD. No new dependency — canvas does the resize.
//
// The bucket ('meal-photos') is private; every upload/signed-URL call is
// denied until the four storage.objects policies are created by hand
// (0033_meal_photos_bucket.sql cannot create them — see that file's comment).

import { MEAL_PHOTO, MEAL_TIME_ROUND_MINUTES } from '@/app.config';
import { supabase } from '@/lib/supabase';

/**
 * Longest-edge fit. Pure and exported so it can be unit-tested — the only part
 * of this module that runs outside a browser. Never upscales.
 */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/**
 * Downscale to a JPEG blob. Returns null if the browser cannot decode the file
 * — the realistic HEIC-from-the-iOS-library case — and the caller falls back to
 * uploading the original.
 *
 * `imageOrientation: 'from-image'` on createImageBitmap is LOAD-BEARING.
 * Without it every photo taken in portrait comes back rotated, because the
 * pixels are landscape and the rotation lives only in the EXIF the canvas
 * throws away.
 */
export async function downscale(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MEAL_PHOTO.maxEdgePx);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', MEAL_PHOTO.quality);
  });
}

/**
 * Upload, return the object path or null. Path is '<owner uuid>/<uuid>.jpg' and
 * the leading segment is not cosmetic: every policy keys on
 * (storage.foldername(name))[1]. This is the only function that builds a path.
 */
export async function uploadMealPhoto(file: File): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let blob: Blob | null = await downscale(file);
  if (!blob) {
    if (file.size > MEAL_PHOTO.maxBytes) return null;
    blob = file;
  }

  const path = `${user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(MEAL_PHOTO.bucket)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) return null;
  return path;
}

/** Short-lived signed URL (3600s). The bucket is private; no public URL exists. */
export async function mealPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(MEAL_PHOTO.bucket).createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteMealPhoto(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(MEAL_PHOTO.bucket).remove([path]);
  return !error;
}

/** 'HH:MM' for now, rounded to the nearest MEAL_TIME_ROUND_MINUTES. */
export function nowRounded(d = new Date()): string {
  const rounded = new Date(d);
  const minutes = rounded.getMinutes();
  const rem = minutes % MEAL_TIME_ROUND_MINUTES;
  const roundedMinutes = rem < MEAL_TIME_ROUND_MINUTES / 2 ? minutes - rem : minutes + (MEAL_TIME_ROUND_MINUTES - rem);
  rounded.setMinutes(roundedMinutes, 0, 0);
  const hh = String(rounded.getHours()).padStart(2, '0');
  const mm = String(rounded.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 'YYYY-MM-DD' for the LOCAL day — not toISOString(), which is UTC.
 * `new Date().toISOString().slice(0,10)` is used elsewhere in this repo and is
 * wrong after 18:30 in IST — it returns tomorrow. Meals are logged in the
 * evening constantly, so this uses local components. Do not "fix" the existing
 * callsites here — real bug, out of scope.
 */
export function todayLocal(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
