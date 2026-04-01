import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  CallEmbedContextProvider,
  CallEmbedRefContextProvider,
  useCallHangupEvent,
  useCallJoined,
  useCallThemeSync,
  useCallMemberSoundSync,
} from '../hooks/useCallEmbed';
import { callChatAtom, callEmbedAtom } from '../state/callEmbed';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { CallEmbed } from '../plugins/call';
import { useSelectedRoom } from '../hooks/router/useSelectedRoom';
import { ScreenSize, useScreenSizeContext } from '../hooks/useScreenSize';
import NotificationSound from '../../../public/sound/notification.ogg';
import InviteSound from '../../../public/sound/invite.ogg';
import { isNonCharacterKey, isKeyTriggeringUIevents } from '../utils/keyboard';

function CallUtils({ embed }: { embed: CallEmbed }) {
  const setCallEmbed = useSetAtom(callEmbedAtom);

  useCallMemberSoundSync(embed);
  useCallThemeSync(embed);
  useCallHangupEvent(
    embed,
    useCallback(() => {
      setCallEmbed(undefined);
    }, [setCallEmbed])
  );

  return null;
}

type CallEmbedProviderProps = {
  children?: ReactNode;
};
export function CallEmbedProvider({ children }: CallEmbedProviderProps) {
  const callEmbed = useAtomValue(callEmbedAtom);
  const callEmbedRef = useRef<HTMLDivElement>(null);
  const joined = useCallJoined(callEmbed);

  const selectedRoom = useSelectedRoom();
  const chat = useAtomValue(callChatAtom);
  const screenSize = useScreenSizeContext();
  const chatOnlyView = chat && screenSize !== ScreenSize.Desktop;
  const callVisible = callEmbed && selectedRoom === callEmbed.roomId && joined && !chatOnlyView;

  const [pushToTalk] = useSetting(settingsAtom, 'pushToTalk');
  const [pushToTalkKey] = useSetting(settingsAtom, 'pushToTalkKey');
  const [pushToMute] = useSetting(settingsAtom, 'pushToMute');
  const [pushToMuteKey] = useSetting(settingsAtom, 'pushToMuteKey');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const pushKeyPressedRef = useRef({ PTT: false, PTM: false });
  const enableAudioRef = useRef<HTMLAudioElement>(null);
  const disableAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!callEmbed) return;

    callEmbed.control.setPushToTalk(pushToTalk);
    callEmbed.control.setPushToMute(pushToMute);

    const setKeyPressed = (key: 'PTT' | 'PTM', pressed: boolean) => {
      if (pushKeyPressedRef.current[key] === pressed) return;

      if (key === 'PTT') {
        callEmbed?.control.setPushToTalkKeyPressed(pressed);
      } else if (key === 'PTM') {
        callEmbed?.control.setPushToMuteKeyPressed(pressed);
      }
      pushKeyPressedRef.current[key] = pressed;

      if (notificationSound) {
        const audio = pressed ? enableAudioRef.current : disableAudioRef.current;
        if (audio) {
          audio.volume = 0.12;
          audio.currentTime = 0;
          audio.play().catch(() => undefined);
        }
      }
    };

    if (!pushToTalk) {
      setKeyPressed('PTT', false);
    }
    if (!pushToMute) {
      setKeyPressed('PTM', false);
    }

    const isTyping = (evt: KeyboardEvent) => {
      if (isNonCharacterKey(evt.code)) {
        return false;
      }
      const ae = document.activeElement;
      return ae
        ? ae.nodeName.toLowerCase() === 'input' ||
          ae.nodeName.toLowerCase() === 'textarea' ||
          ae.getAttribute('contenteditable') === 'true'
        : false;
    };

    const resetKeys = () => {
      if (pushKeyPressedRef.current.PTT) {
        setKeyPressed('PTT', false);
      }
      if (pushKeyPressedRef.current.PTM) {
        setKeyPressed('PTM', false);
      }
    };

    const handleKeyDown = (evt: KeyboardEvent) => {
      if (isTyping(evt)) return;

      if (pushToTalk && evt.code === pushToTalkKey) {
        if (isKeyTriggeringUIevents(evt.code)) {
          evt.preventDefault();
        }
        setKeyPressed('PTT', true);
      }
      if (pushToMute && evt.code === pushToMuteKey) {
        if (isKeyTriggeringUIevents(evt.code)) {
          evt.preventDefault();
        }
        setKeyPressed('PTM', true);
      }
    };

    const handleKeyUp = (evt: KeyboardEvent) => {
      if (pushToTalk && evt.code === pushToTalkKey) {
        if (isKeyTriggeringUIevents(evt.code)) {
          evt.preventDefault();
        }
        setKeyPressed('PTT', false);
      }
      if (pushToMute && evt.code === pushToMuteKey) {
        if (isKeyTriggeringUIevents(evt.code)) {
          evt.preventDefault();
        }
        setKeyPressed('PTM', false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        resetKeys();
      }
    };

    const handleBlur = () => {
      resetKeys();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [callEmbed, pushToTalk, pushToTalkKey, pushToMute, pushToMuteKey, notificationSound]);

  return (
    <CallEmbedContextProvider value={callEmbed}>
      {callEmbed && <CallUtils embed={callEmbed} />}
      <CallEmbedRefContextProvider value={callEmbedRef}>{children}</CallEmbedRefContextProvider>
      <audio ref={enableAudioRef} style={{ display: 'none' }}>
        <source src={NotificationSound} type="audio/ogg" />
      </audio>
      <audio ref={disableAudioRef} style={{ display: 'none' }}>
        <source src={InviteSound} type="audio/ogg" />
      </audio>
      <div
        data-call-embed-container
        style={{
          visibility: callVisible ? undefined : 'hidden',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '50%',
        }}
        ref={callEmbedRef}
      />
    </CallEmbedContextProvider>
  );
}