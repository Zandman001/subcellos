const MIN_ENV_TIME_SEC = 0.001;
const MAX_ENV_TIME_SEC = 4.0;
const LOG_RANGE = Math.log(MAX_ENV_TIME_SEC / MIN_ENV_TIME_SEC);

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function envTimeFromNorm(value: number): number {
  const v = Number.isFinite(value) ? value : 0;
  const n = clamp01(v);
  return MIN_ENV_TIME_SEC * Math.pow(MAX_ENV_TIME_SEC / MIN_ENV_TIME_SEC, n);
}

export function envTimeMsFromNorm(value: number): number {
  return envTimeFromNorm(value) * 1000.0;
}

export function envTimeNormFromSeconds(seconds: number): number {
  const s = (typeof seconds === 'number' && Number.isFinite(seconds)) ? seconds : MIN_ENV_TIME_SEC;
  const clamped = Math.min(Math.max(s, MIN_ENV_TIME_SEC), MAX_ENV_TIME_SEC);
  return Math.log(clamped / MIN_ENV_TIME_SEC) / LOG_RANGE;
}

export function envTimeNormFromMilliseconds(msOrSec: number): number {
  const v = (typeof msOrSec === 'number' && Number.isFinite(msOrSec)) ? msOrSec : 100.0;
  const seconds = v > 8.0 ? v * 0.001 : v;
  return envTimeNormFromSeconds(seconds);
}

export function formatEnvTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0ms';
  return seconds < 0.1 ? `${Math.round(seconds * 1000)}ms` : `${seconds.toFixed(2)}s`;
}

export const ENV_TIME_RANGE = { minSeconds: MIN_ENV_TIME_SEC, maxSeconds: MAX_ENV_TIME_SEC } as const;
