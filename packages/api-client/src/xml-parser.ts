import { XMLParser } from 'fast-xml-parser';
import { AuthFailedError, ClientBugError, ServerError } from './errors.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (name: string): boolean => name === 'meeting' || name === 'attendee',
});

export function parseXmlResponse<T = Record<string, unknown>>(xmlString: string): T {
  if (!xmlString || typeof xmlString !== 'string') {
    throw new ClientBugError('Empty or invalid XML response received from BBB server');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlString) as Record<string, unknown>;
  } catch (err) {
    throw new ClientBugError('Failed to parse XML response from BBB server', err);
  }

  const root = (parsed.response || parsed) as Record<string, unknown>;

  if (!root || typeof root !== 'object') {
    throw new ClientBugError('Invalid XML structure: missing <response> root element');
  }

  const returncode = String(root.returncode || '').toUpperCase();

  if (returncode === 'FAILED') {
    const messageKey = root.messageKey ? String(root.messageKey) : undefined;
    const message = root.message ? String(root.message) : 'BBB API call failed';

    if (messageKey === 'checksumError' || message.toLowerCase().includes('checksum')) {
      throw new AuthFailedError(message, messageKey);
    }

    if (messageKey === 'idNotUnique' || messageKey === 'invalidPassword') {
      throw new AuthFailedError(message, messageKey);
    }

    throw new ServerError(message, undefined, messageKey, root);
  }

  return root as T;
}
