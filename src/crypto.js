// Password hashing (PBKDF2-SHA256) and session tokens using Web Crypto.
// 100,000 iterations is the maximum the Cloudflare Workers runtime allows.

const enc = new TextEncoder();
const ITERATIONS = 100000;

function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iterations, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2' || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64u(salt), Number(iterations));
  return equal(actual, fromB64u(hash));
}

export function randomToken() {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text) {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function safeEqual(a, b) {
  return equal(fromB64u(await sha256(String(a))), fromB64u(await sha256(String(b))));
}
