// Passphrase-protected key storage. AES-GCM with a key derived by PBKDF2-SHA-256
// (600k iterations by default, random 16-byte salt, random 12-byte IV). The
// plaintext key never leaves memory.
import { AppError, ERROR_CODES } from '@sajas/core/errors';

export const KEY_ITERATIONS = 600000;

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new AppError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser cannot encrypt the saved key.');
  return s;
}

function toBase64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase, salt, iterations = KEY_ITERATIONS) {
  const material = await subtle().importKey('raw', new TextEncoder().encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(secret, passphrase, { iterations = KEY_ITERATIONS } = {}) {
  if (!String(passphrase || '')) throw new AppError(ERROR_CODES.VALIDATION, 'Enter a passphrase to save the key.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(secret)));
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptSecret(blob, passphrase) {
  if (!blob || typeof blob !== 'object' || blob.v !== 1 || !blob.salt || !blob.iv || !blob.ciphertext) {
    throw new AppError(ERROR_CODES.VALIDATION, 'The saved key is not readable.');
  }
  try {
    const key = await deriveKey(passphrase, fromBase64(blob.salt), blob.iterations || KEY_ITERATIONS);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION, 'That passphrase did not unlock the saved key.', {
      hint: 'Try again. The saved key cannot be recovered without its passphrase.'
    });
  }
}
