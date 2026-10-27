// The only place a plaintext API key lives in the web app: a closure variable.
// Optional persistence is an encrypted blob in the vault; idle forget drops both
// the memory reference and, only when asked, the blob.
import { AppError, ERROR_CODES } from '@sajas/core/errors';
import { limit } from './limits.js';
import {
  normalizeKeyInput,
  isAnthropicKeyShape,
  isAdminKeyShape
} from '@sajas/core/secrets';
import { STORES } from './vault.js';
import { encryptSecret, decryptSecret } from './keyCrypto.js';

export const KEY_VAULT_KEY = 'anthropic';
export const MIN_PASSPHRASE = 10;
export const IDLE_OPTIONS = Object.freeze([15, 30, 60]);
export const DEFAULT_IDLE_MINUTES = 30;
const META_KEY = 'key';

export function createKeyStore({ vault, now = () => Date.now(), encrypt = encryptSecret, decrypt = decryptSecret } = {}) {
  let key = null;
  let lastActivity = 0;
  let idleMinutes = DEFAULT_IDLE_MINUTES;

  async function readMeta() {
    return vault.get(STORES.meta, META_KEY, {});
  }

  async function writeMeta(patch) {
    const current = await readMeta();
    await vault.put(STORES.meta, META_KEY, { ...current, ...patch });
  }

  const store = {
    hasKey: () => Boolean(key),
    getKey: () => key,

    setKey(raw) {
      const value = limit(normalizeKeyInput(raw), 512);
      if (!value) throw new AppError(ERROR_CODES.KEY_INVALID, 'Paste an Anthropic API key first.');
      if (isAdminKeyShape(value)) {
        throw new AppError(ERROR_CODES.KEY_ADMIN, 'That is an Anthropic Admin key. Create a standard API key in the Console and use that instead.');
      }
      if (!isAnthropicKeyShape(value)) {
        throw new AppError(ERROR_CODES.KEY_INVALID, 'That does not look like an Anthropic API key. It should start with sk-ant-api.');
      }
      key = value;
      store.touch();
      return key;
    },

    clearMemory() {
      key = null;
      lastActivity = 0;
    },

    touch() {
      lastActivity = now();
    },

    setIdleMinutes(minutes) {
      const value = Number(minutes);
      if (!IDLE_OPTIONS.includes(value)) {
        throw new AppError(ERROR_CODES.VALIDATION, 'Choose 15, 30 or 60 minutes.');
      }
      idleMinutes = value;
    },

    getIdleMinutes: () => idleMinutes,

    async saveIdleMinutes(minutes) {
      store.setIdleMinutes(minutes);
      await writeMeta({ idleMinutes });
    },

    async loadIdleMinutes() {
      const meta = await readMeta();
      if (IDLE_OPTIONS.includes(Number(meta.idleMinutes))) idleMinutes = Number(meta.idleMinutes);
      return idleMinutes;
    },

    isIdleExpired(at = now()) {
      return Boolean(key) && lastActivity > 0 && at - lastActivity >= idleMinutes * 60_000;
    },

    maybeForgetIdle(at = now()) {
      if (!store.isIdleExpired(at)) return false;
      store.clearMemory();
      return true;
    },

    async hasSavedKey() {
      return Boolean(await vault.get(STORES.keyVault, KEY_VAULT_KEY));
    },

    async remember(passphrase) {
      if (!key) throw new AppError(ERROR_CODES.KEY_INVALID, 'Add the key before saving it.');
      if (String(passphrase || '').length < MIN_PASSPHRASE) {
        throw new AppError(ERROR_CODES.VALIDATION, `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      }
      const blob = await encrypt(key, passphrase);
      await vault.put(STORES.keyVault, KEY_VAULT_KEY, blob);
      await writeMeta({ idleMinutes, remembered: true });
      return blob;
    },

    async unlock(passphrase) {
      const blob = await vault.get(STORES.keyVault, KEY_VAULT_KEY);
      if (!blob) throw new AppError(ERROR_CODES.NOT_FOUND, 'No saved key was found on this device.');
      const plain = await decrypt(blob, passphrase);
      return store.setKey(plain);
    },

    async forget({ wipeSaved = true } = {}) {
      store.clearMemory();
      if (wipeSaved) await vault.delete(STORES.keyVault, KEY_VAULT_KEY);
      // The flag must mirror the vault: a kept blob still needs the unlock screen
      // after reload, so only report "not remembered" once it is really gone.
      const remembered = await store.hasSavedKey();
      const meta = await readMeta();
      await vault.put(STORES.meta, META_KEY, { ...meta, idleMinutes, remembered });
    },

    async panicWipe() {
      store.clearMemory();
      await vault.wipe();
    }
  };

  return store;
}
