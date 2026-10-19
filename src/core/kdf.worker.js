import { argon2id } from 'hash-wasm';

self.onmessage = async (e) => {
  const { id, password, salt, t, m, p, len } = e.data;
  try {
    const out = await argon2id({ password, salt, iterations: t, memorySize: m, parallelism: p, hashLength: len, outputType: 'binary' });
    self.postMessage({ id, ok: true, out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, err: String(err && err.message ? err.message : err) });
  }
};
