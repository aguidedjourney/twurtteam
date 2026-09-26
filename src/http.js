export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Expected a JSON body');
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// Input validators. Each returns a clean value or throws a 400.
export const v = {
  str(val, name, { max = 200, required = false } = {}) {
    if (val === undefined || val === null) val = '';
    val = String(val).trim();
    if (!val) {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    if (val.length > max) throw new HttpError(400, `${name} must be ${max} characters or fewer`);
    return val;
  },

  // Dollar amount (number or "1,234.56") -> integer cents.
  money(val, name, { required = true, min = 0 } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    const n = typeof val === 'number' ? val : Number(String(val).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
    if (n < min) throw new HttpError(400, `${name} must be at least ${min}`);
    if (Math.abs(n) > 1e9) throw new HttpError(400, `${name} is too large`);
    return Math.round(n * 100);
  },

  int(val, name, { required = false, min = -1e9, max = 1e9 } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    const n = Number(val);
    if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
    if (n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
    return n;
  },

  id(val, name) {
    return v.int(val, name, { min: 1 });
  },

  date(val, name, { required = false } = {}) {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    val = String(val);
    const d = new Date(val + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || isNaN(d) || d.toISOString().slice(0, 10) !== val) {
      throw new HttpError(400, `${name} must be a valid date (YYYY-MM-DD)`);
    }
    return val;
  },

  oneOf(val, name, options, fallback) {
    if ((val === undefined || val === null || val === '') && fallback !== undefined) return fallback;
    if (!options.includes(val)) throw new HttpError(400, `${name} must be one of: ${options.join(', ')}`);
    return val;
  },

  bool(val) {
    return val === true || val === 1 || val === '1' || val === 'true';
  },
};
