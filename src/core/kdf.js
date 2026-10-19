// Dérivation de clé Argon2id (hash-wasm, WebAssembly).
// Dans l'appli, le calcul tourne dans un Web Worker pour que les animations restent fluides
// pendant le déverrouillage ; sans Worker (tests Node), il est fait directement.

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') throw new Error('no worker');
    worker = new Worker(new URL('./kdf.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, out, err } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(new Uint8Array(out)) : p.reject(new Error(err));
    };
    worker.onerror = () => {
      // Worker indisponible (ex. serveur de dev sans bundler) : on bascule en direct.
      for (const p of pending.values()) p.retry();
      pending.clear();
      worker = false;
    };
  } catch {
    worker = false;
  }
  return worker;
}

async function direct({ password, salt, t, m, p, len }) {
  const { argon2id } = await import('hash-wasm');
  return argon2id({
    password,
    salt,
    iterations: t,
    memorySize: m,
    parallelism: p,
    hashLength: len,
    outputType: 'binary',
  });
}

/**
 * Argon2id brut.
 * @param {string|Uint8Array} password
 * @param {Uint8Array} salt
 * @param {{t:number,m:number,p:number}} params  t = itérations, m = mémoire en Kio, p = voies
 */
export function argon2id(password, salt, { t, m, p }, len = 32) {
  const job = { password, salt, t, m, p, len };
  const w = getWorker();
  if (!w) return direct(job);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, retry: () => direct(job).then(resolve, reject) });
    w.postMessage({ id, ...job });
  });
}
