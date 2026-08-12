export const LOGIN_LOG_RETENTION_DAYS = 90;
export const MAX_LOGIN_IP_LENGTH = 64;
export const MAX_LOGIN_USER_AGENT_LENGTH = 512;

function truncate(value: string, maxLength: number) {
  return value.replace(/[\r\n\0]/g, '').slice(0, maxLength);
}

export async function logLoginAttempt(
  db: D1Database,
  ip: string,
  userAgent: string,
  success: boolean
) {
  await db.prepare(
    'INSERT INTO login_logs (ip, user_agent, success) VALUES (?, ?, ?)'
  ).bind(
    truncate(ip, MAX_LOGIN_IP_LENGTH),
    truncate(userAgent, MAX_LOGIN_USER_AGENT_LENGTH),
    success ? 1 : 0
  ).run();
}

export async function cleanupExpiredLoginLogs(db: D1Database) {
  return db.prepare(
    `DELETE FROM login_logs
     WHERE created_at < datetime('now', ?)`
  ).bind(`-${LOGIN_LOG_RETENTION_DAYS} days`).run();
}
