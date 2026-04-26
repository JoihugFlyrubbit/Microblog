import { Hono } from 'hono';
import { Env } from '../types';

export const environmentRouter = new Hono<{ Bindings: Env }>();

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function getLocation(env: Env) {
  const latitude = Number(env.ENV_LATITUDE);
  const longitude = Number(env.ENV_LONGITUDE);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    label: env.ENV_LOCATION_LABEL || 'Configured location',
    latitude,
    longitude,
    timezone: env.ENV_TIMEZONE || DEFAULT_TIMEZONE,
  };
}

function toBase64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalizedPem = pem
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');

  const base64 = normalizedPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function createQWeatherToken(env: Env): Promise<string> {
  if (!env.QWEATHER_PRIVATE_KEY || !env.QWEATHER_KEY_ID || !env.QWEATHER_PROJECT_ID) {
    throw new Error('QWeather credentials are not configured');
  }

  const header = {
    alg: 'EdDSA',
    kid: env.QWEATHER_KEY_ID,
    typ: '',
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: env.QWEATHER_PROJECT_ID,
    iat: now - 30,
    exp: now + 900,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.QWEATHER_PRIVATE_KEY),
    { name: 'Ed25519' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(data)
  );

  return `${data}.${toBase64Url(signature)}`;
}

async function fetchQWeatherAqi(env: Env) {
  const location = getLocation(env);
  if (!location) {
    throw new Error('Environment location is not configured');
  }
  if (!env.QWEATHER_API_HOST) {
    throw new Error('QWeather API host is not configured');
  }
  const token = await createQWeatherToken(env);
  const response = await fetch(
    `https://${env.QWEATHER_API_HOST}/airquality/v1/current/${location.latitude.toFixed(2)}/${location.longitude.toFixed(2)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`QWeather AQI request failed: ${response.status}`);
  }

  const data = await response.json() as {
    indexes?: Array<{
      code: string;
      aqi: string;
      category: string;
      primaryPollutant?: { name?: string };
    }>
  };

  const cn = data.indexes?.find((item) => item.code === 'cn-mee');
  if (!cn) {
    throw new Error('QWeather cn-mee index not found');
  }

  return {
    value: Number(cn.aqi),
    category: cn.category,
    pollutant: cn.primaryPollutant?.name || 'N/A',
  };
}

async function fetchUv(env: Env) {
  const location = getLocation(env);
  if (!location) {
    throw new Error('Environment location is not configured');
  }
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('hourly', 'uv_index');
  url.searchParams.set('timezone', location.timezone);
  url.searchParams.set('forecast_days', '1');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Open-Meteo UV request failed: ${response.status}`);
  }

  const data = await response.json() as {
    hourly?: {
      time: string[];
      uv_index: number[];
    }
  };

  const times = data.hourly?.time || [];
  const values = data.hourly?.uv_index || [];
  if (times.length === 0 || values.length === 0) {
    throw new Error('Open-Meteo UV data missing');
  }

  const day = times
    .map((time, index) => ({ hour: Number(time.slice(11, 13)), value: values[index] }))
    .filter((item) => item.hour >= 6 && item.hour <= 20);
  if (day.length === 0) {
    throw new Error('Open-Meteo daytime UV data missing');
  }
  const nowHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: location.timezone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date()));
  const current = day.find((item) => item.hour === nowHour)
    || day.reduce((closest, item) =>
      Math.abs(item.hour - nowHour) < Math.abs(closest.hour - nowHour) ? item : closest
    );
  const uvNow = Math.round(current.value);
  const uvMax = Math.round(Math.max(...day.map((item) => item.value)));
  const unsafe = day.filter((item) => item.value > 1);

  let summary = `当前 UV ${uvNow}，今日峰值 ${uvMax}`;
  if (unsafe.length > 0) {
    const firstUnsafe = unsafe[0].hour;
    const recoverHour = unsafe[unsafe.length - 1].hour + 1;
    summary = `${summary}；${String(firstUnsafe).padStart(2, '0')}:00 前和 ${String(recoverHour).padStart(2, '0')}:00 后 UV≤2`;
  }

  return {
    value: uvNow,
    max: uvMax,
    summary,
  };
}

environmentRouter.get('/live', async (c) => {
  const location = getLocation(c.env);
  const result = {
    location: location ? {
      label: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
      qweatherLocation: `${location.longitude.toFixed(2)},${location.latitude.toFixed(2)}`,
    } : null,
    updatedAt: new Date().toISOString(),
    aqi: {
      value: null as number | null,
      category: null as string | null,
      pollutant: null as string | null,
      status: 'unavailable' as 'ok' | 'unavailable',
    },
    uv: {
      value: null as number | null,
      summary: null as string | null,
      status: 'unavailable' as 'ok' | 'unavailable',
    },
  };

  try {
    const aqi = await fetchQWeatherAqi(c.env);
    result.aqi = { ...aqi, status: 'ok' };
  } catch (error) {
    console.error('Environment AQI fetch failed:', error);
  }

  try {
    const uv = await fetchUv(c.env);
    result.uv = { ...uv, status: 'ok' };
  } catch (error) {
    console.error('Environment UV fetch failed:', error);
  }

  return c.json({
    success: true,
    data: result,
  });
});
