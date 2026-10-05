export * from './adapter.js';
export * from './types.js';
export { V30Adapter } from './adapters/v30/index.js';
export { discoverClientConfig, parseVersion } from './adapters/v30/config.js';
export { openV30Signaling } from './adapters/v30/signaling.js';
export { openV30Sfu, fetchV30IceServers, parseIceServers, type SfuMessage } from './adapters/v30/sfu.js';
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
  chatSendMessage,
  setRaiseHand,
  cameraBroadcastStart,
  cameraBroadcastStop,
  userSetListenOnlyInput,
  userSetMuted,
  MAIN_PUBLIC_CHAT_ID,
  type UserJoinVariables,
} from './adapters/v30/operations.js';

export const PROTOCOL_PLACEHOLDER = 'protocol';
