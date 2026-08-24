import type { MutationSpec, SubscriptionSpec } from '../../types.js';

const USER_CURRENT_QUERY = "subscription Patched_userCurrentSubscription {\n  user_current {\n    authToken\n    avatar\n    webcamBackground\n    away\n    clientType\n    color\n    ejectReason\n    ejectReasonCode\n    ejected\n    reactionEmoji\n    extId\n    guest\n    guestStatus\n    whiteboardWriteAccess\n    inactivityWarningDisplay\n    inactivityWarningTimeoutSecs\n    isDialIn\n    isModerator\n    logoutUrl\n    currentlyInMeeting\n    joinErrorCode\n    joinErrorMessage\n    joined\n    locked\n    loggedOut\n    mobile\n    name\n    nameSortable\n    pinned\n    presenter\n    raiseHand\n    registeredAt\n    role\n    speechLocale\n    captionLocale\n    userId\n    meeting {\n      ended\n      endedReasonCode\n      endedByUserName\n      logoutUrl\n      __typename\n    }\n    lastBreakoutRoom {\n      currentlyInRoom\n      sequence\n      shortName\n      __typename\n    }\n    breakoutRoomsSummary {\n      totalOfBreakoutRooms\n      totalOfIsUserCurrentlyInRoom\n      totalOfShowInvitation\n      totalOfJoinURL\n      __typename\n    }\n    cameras {\n      streamId\n      __typename\n    }\n    voice {\n      joined\n      spoke\n      listenOnly\n      deafened\n      listenOnlyInputDevice\n      __typename\n    }\n    userLockSettings {\n      disablePublicChat\n      __typename\n    }\n    sessionCurrent {\n      enforceLayout\n      __typename\n    }\n    livekit {\n      livekitToken\n      __typename\n    }\n    __typename\n  }\n}";

const MEETING_QUERY = "subscription Patched_MeetingSubscription {\n  meeting {\n    durationInSeconds\n    lockSettings {\n      disableCam\n      disableMic\n      disableNotes\n      disablePrivateChat\n      disablePublicChat\n      hasActiveLockSetting\n      hideUserList\n      hideViewersCursor\n      hideViewersAnnotation\n      webcamsOnlyForModerator\n      lockOnJoin\n      lockOnJoinConfigurable\n      __typename\n    }\n    learningDashboard {\n      learningDashboardAccessToken\n      __typename\n    }\n    screenshare {\n      contentType\n      hasAudio\n      screenshareConf\n      screenshareId\n      startedAt\n      stoppedAt\n      stream\n      vidHeight\n      vidWidth\n      voiceConf\n      __typename\n    }\n    usersPolicies {\n      guestPolicy\n      guestLobbyMessage\n      webcamsOnlyForModerator\n      __typename\n    }\n    layout {\n      cameraDockAspectRatio\n      cameraDockIsResizing\n      cameraDockPlacement\n      cameraWithFocus\n      currentLayoutType\n      presentationMinimized\n      propagateLayout\n      updatedAt\n      __typename\n    }\n    breakoutRoomsCommonProperties {\n      durationInSeconds\n      freeJoin\n      sendInvitationToModerators\n      startedAt\n      __typename\n    }\n    externalVideo {\n      externalVideoId\n      playerCurrentTime\n      playerPlaybackRate\n      playerPlaying\n      externalVideoUrl\n      startedSharingAt\n      stoppedSharingAt\n      updatedAt\n      __typename\n    }\n    componentsFlags {\n      hasBreakoutRoom\n      hasCameraAsContent\n      hasCaption\n      hasCurrentPresentation\n      hasExternalVideo\n      hasPoll\n      hasScreenshare\n      hasScreenshareAsContent\n      hasSharedNotes\n      hasTimer\n      isSharedNotesPinned\n      showRemainingTime\n      __typename\n    }\n    __typename\n  }\n}";

const USER_LIST_QUERY = "subscription Patched_UserListSubscription($offset: Int!, $limit: Int!) {\n  user(\n    limit: $limit\n    offset: $offset\n    order_by: [{presenter: desc}, {role: asc}, {raiseHandTime: asc_nulls_last}, {isDialIn: desc}, {whiteboardWriteAccess: desc}, {nameSortable: asc}, {registeredAt: asc}, {userId: asc}]\n  ) {\n    isDialIn\n    userId\n    meetingId\n    extId\n    name\n    isModerator\n    role\n    color\n    avatar\n    away\n    raiseHand\n    reactionEmoji\n    avatar\n    presenter\n    pinned\n    locked\n    authed\n    mobile\n    bot\n    guest\n    clientType\n    disconnected\n    loggedOut\n    voice {\n      joined\n      deafened\n      listenOnly\n      voiceUserId\n      listenOnlyInputDevice\n      __typename\n    }\n    cameras {\n      streamId\n      __typename\n    }\n    whiteboardWriteAccess\n    lastBreakoutRoom {\n      isDefaultName\n      sequence\n      shortName\n      currentlyInRoom\n      __typename\n    }\n    userLockSettings {\n      disablePublicChat\n      __typename\n    }\n    __typename\n  }\n}";

const CHAT_QUERY = "subscription ChatSubscription {\n  chat(order_by: [{chatId: asc}]) {\n    chatId\n    participant {\n      userId\n      name\n      nameSortable\n      role\n      color\n      loggedOut\n      avatar\n      currentlyInMeeting\n      isModerator\n      __typename\n    }\n    totalMessages\n    totalUnread\n    public\n    lastSeenAt\n    __typename\n  }\n}";

const USERS_COUNT_QUERY = "subscription UsersCount {\n  user_aggregate {\n    aggregate {\n      count\n      __typename\n    }\n    __typename\n  }\n}";

const VIDEO_STREAMS_QUERY = "subscription Patched_VideoStreams {\n  user_camera {\n    streamId\n    user {\n      name\n      userId\n      nameSortable\n      pinned\n      away\n      disconnected\n      role\n      avatar\n      color\n      presenter\n      clientType\n      raiseHand\n      isModerator\n      reactionEmoji\n      __typename\n    }\n    voice {\n      floor\n      lastFloorTime\n      joined\n      listenOnly\n      userId\n      deafened\n      __typename\n    }\n    __typename\n  }\n}";

const RAISED_HAND_USERS_QUERY = "subscription RaisedHandUsers {\n  user(\n    where: {raiseHand: {_eq: true}}\n    order_by: [{raiseHandTime: asc_nulls_last}]\n  ) {\n    userId\n    name\n    color\n    presenter\n    isModerator\n    raiseHand\n    raiseHandTime\n    __typename\n  }\n}";

const USER_JOIN_MUTATION = "mutation UserJoin($authToken: String!, $clientType: String!, $clientIsMobile: Boolean!) {\n  userJoinMeeting(\n    authToken: $authToken\n    clientType: $clientType\n    clientIsMobile: $clientIsMobile\n  )\n}";

export const userCurrentSubscription = (): SubscriptionSpec => ({
  operationName: 'Patched_userCurrentSubscription',
  query: USER_CURRENT_QUERY,
});

export const meetingSubscription = (): SubscriptionSpec => ({
  operationName: 'Patched_MeetingSubscription',
  query: MEETING_QUERY,
});

export const userListSubscription = (offset = 0, limit = 50): SubscriptionSpec => ({
  operationName: 'Patched_UserListSubscription',
  query: USER_LIST_QUERY,
  variables: { offset, limit },
});

export const chatSubscription = (): SubscriptionSpec => ({
  operationName: 'ChatSubscription',
  query: CHAT_QUERY,
});

export const usersCountSubscription = (): SubscriptionSpec => ({
  operationName: 'UsersCount',
  query: USERS_COUNT_QUERY,
});

export const videoStreamsSubscription = (): SubscriptionSpec => ({
  operationName: 'Patched_VideoStreams',
  query: VIDEO_STREAMS_QUERY,
});

export const raisedHandUsersSubscription = (): SubscriptionSpec => ({
  operationName: 'RaisedHandUsers',
  query: RAISED_HAND_USERS_QUERY,
});

export interface UserJoinVariables {
  clientType?: string;
  clientIsMobile?: boolean;
}

export const userJoinMutation = (
  authToken: string,
  options: UserJoinVariables = {}
): MutationSpec => ({
  operationName: 'UserJoin',
  query: USER_JOIN_MUTATION,
  variables: {
    authToken,
    clientType: options.clientType ?? 'HTML5',
    clientIsMobile: options.clientIsMobile ?? false,
  },
});

export const coreSubscriptions = (): SubscriptionSpec[] => [
  userCurrentSubscription(),
  meetingSubscription(),
  userListSubscription(),
  chatSubscription(),
  usersCountSubscription(),
  videoStreamsSubscription(),
  raisedHandUsersSubscription(),
];
