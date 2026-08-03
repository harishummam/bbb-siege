import { ClientBugError } from './errors.js';

export function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    throw new ClientBugError(`Invalid target URL: "${url}"`);
  }
}

export function matchesPattern(hostname: string, pattern: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();

  if (!normalizedPattern) return false;
  if (normalizedHost === normalizedPattern) return true;

  if (normalizedPattern.startsWith('*.')) {
    const domain = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${domain}`) || normalizedHost === domain;
  }

  return false;
}

export function validateTargetHost(
  targetUrl: string,
  options?: { iUnderstand?: boolean; testHosts?: string[] }
): void {
  const iUnderstand =
    options?.iUnderstand ?? process.env.BBB_I_UNDERSTAND === 'true';

  if (iUnderstand) {
    return;
  }

  const hostname = extractHostname(targetUrl);

  const envHosts = process.env.BBB_TEST_HOSTS
    ? process.env.BBB_TEST_HOSTS.split(/[,;]/).map((h) => h.trim()).filter(Boolean)
    : [];

  const allowedHosts = options?.testHosts && options.testHosts.length > 0
    ? options.testHosts
    : envHosts.length > 0
    ? envHosts
    : ['localhost', '127.0.0.1', '::1'];

  const isAllowed = allowedHosts.some((pattern) => matchesPattern(hostname, pattern));

  if (!isAllowed) {
    throw new ClientBugError(
      `Target host "${hostname}" is not permitted by BBB_TEST_HOSTS allowlist (${allowedHosts.join(
        ', '
      )}). Pass iUnderstand: true / --i-understand or add host to BBB_TEST_HOSTS.`
    );
  }
}
