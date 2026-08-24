export * from './adapter.js';
export * from './types.js';
export { V30Adapter } from './adapters/v30/index.js';
export { discoverClientConfig, parseVersion } from './adapters/v30/config.js';
export { openV30Signaling } from './adapters/v30/signaling.js';
export {
  coreSubscriptions,
  userCurrentSubscription,
  meetingSubscription,
  userListSubscription,
  chatSubscription,
  usersCountSubscription,
  videoStreamsSubscription,
  raisedHandUsersSubscription,
  userJoinMutation,
  type UserJoinVariables,
} from './adapters/v30/operations.js';

export const PROTOCOL_PLACEHOLDER = 'protocol';
