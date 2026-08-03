export class NotImplemented extends Error {
  constructor(methodName?: string) {
    super(methodName ? `NotImplemented: ${methodName}` : 'NotImplemented');
    this.name = 'NotImplemented';
  }
}

export type MediaStack = 'mediasoup' | 'livekit' | 'unknown';

export interface BbbAdapter {
  createMeeting(...args: unknown[]): Promise<never>;
  join(...args: unknown[]): Promise<never>;
  openSignaling(...args: unknown[]): Promise<never>;
  subscribe(...args: unknown[]): Promise<never>;
  mutate(...args: unknown[]): Promise<never>;
  negotiateMedia(...args: unknown[]): Promise<never>;
  leave(...args: unknown[]): Promise<never>;
  detectVersion(...args: unknown[]): Promise<never>;
  detectMediaStack(...args: unknown[]): Promise<MediaStack>;
}

export class BaseBbbAdapter implements BbbAdapter {
  async createMeeting(): Promise<never> {
    throw new NotImplemented('createMeeting');
  }

  async join(): Promise<never> {
    throw new NotImplemented('join');
  }

  async openSignaling(): Promise<never> {
    throw new NotImplemented('openSignaling');
  }

  async subscribe(): Promise<never> {
    throw new NotImplemented('subscribe');
  }

  async mutate(): Promise<never> {
    throw new NotImplemented('mutate');
  }

  async negotiateMedia(): Promise<never> {
    throw new NotImplemented('negotiateMedia');
  }

  async leave(): Promise<never> {
    throw new NotImplemented('leave');
  }

  async detectVersion(): Promise<never> {
    throw new NotImplemented('detectVersion');
  }

  async detectMediaStack(): Promise<never> {
    throw new NotImplemented('detectMediaStack');
  }
}
