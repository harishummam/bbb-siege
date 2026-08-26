export class SubscriptionState {
  private readonly latest = new Map<string, unknown>();

  update(operationName: string, data: unknown): void {
    this.latest.set(operationName, data);
  }

  get(operationName: string): unknown {
    return this.latest.get(operationName);
  }

  usersCount(): number | undefined {
    const data = this.latest.get('UsersCount') as
      | { user_aggregate?: { aggregate?: { count?: number } } }
      | undefined;
    return data?.user_aggregate?.aggregate?.count;
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.latest);
  }
}
