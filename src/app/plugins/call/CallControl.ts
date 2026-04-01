import { ClientWidgetApi } from 'matrix-widget-api';
import EventEmitter from 'events';
import { CallControlState } from './CallControlState';
import { ElementMediaStateDetail, ElementMediaStatePayload, ElementWidgetActions } from './types';

export enum CallControlEvent {
  StateUpdate = 'state_update',
}

export class CallControl extends EventEmitter implements CallControlState {
  private state: CallControlState;

  private call: ClientWidgetApi;

  private iframe: HTMLIFrameElement;

  private controlMutationObserver: MutationObserver;

  private pushToTalkKeyPressed = false;

  private pushToTalk = false;

  private pushToMuteKeyPressed = false;

  private pushToMute = false;

  private lastSentMediaState?: ElementMediaStatePayload;

  private get document(): Document | undefined {
    return this.iframe.contentDocument ?? this.iframe.contentWindow?.document;
  }

  private get screenshareButton(): HTMLElement | undefined {
    const screenshareBtn = this.document?.querySelector(
      '[data-testid="incall_screenshare"]'
    ) as HTMLElement | null;

    return screenshareBtn ?? undefined;
  }

  private get settingsButton(): HTMLElement | undefined {
    const leaveBtn = this.document?.querySelector('[data-testid="incall_leave"]');

    const settingsButton = leaveBtn?.previousElementSibling as HTMLElement | null;

    return settingsButton ?? undefined;
  }

  private get reactionsButton(): HTMLElement | undefined {
    const reactionsButton = this.settingsButton?.previousElementSibling as HTMLElement | null;

    return reactionsButton ?? undefined;
  }

  private get spotlightButton(): HTMLInputElement | undefined {
    const spotlightButton = this.document?.querySelector(
      'input[value="spotlight"]'
    ) as HTMLInputElement | null;

    return spotlightButton ?? undefined;
  }

  private get gridButton(): HTMLInputElement | undefined {
    const gridButton = this.document?.querySelector(
      'input[value="grid"]'
    ) as HTMLInputElement | null;

    return gridButton ?? undefined;
  }

  constructor(state: CallControlState, call: ClientWidgetApi, iframe: HTMLIFrameElement) {
    super();

    this.state = state;
    this.call = call;
    this.iframe = iframe;

    this.controlMutationObserver = new MutationObserver(this.onControlMutation.bind(this));
  }

  public getState(): CallControlState {
    return this.state;
  }

  public get microphone(): boolean {
    return this.state.microphone;
  }

  public get video(): boolean {
    return this.state.video;
  }

  public get sound(): boolean {
    return this.state.sound;
  }

  public get screenshare(): boolean {
    return this.state.screenshare;
  }

  public get spotlight(): boolean {
    return this.state.spotlight;
  }

  private get effectiveAudioEnabled(): boolean {
    if (this.pushToTalk) {
      return this.microphone && (!this.pushToTalk || this.pushToTalkKeyPressed);
    } else if (this.pushToMute) {
      return this.microphone && (!this.pushToMute || !this.pushToMuteKeyPressed);
    }
    return this.microphone;
  }

  public setPushToTalkKeyPressed(enabled: boolean) {
    this.pushToTalkKeyPressed = enabled;
    if (this.pushToTalk) {
      this.setMediaState({
        audio_enabled: this.effectiveAudioEnabled,
        video_enabled: this.video,
      });
    }
  }

  public setPushToTalk(enabled: boolean) {
    this.pushToTalk = enabled;
    this.setMediaState({
      audio_enabled: this.effectiveAudioEnabled,
      video_enabled: this.video,
    });
  }

  public setPushToMuteKeyPressed(enabled: boolean) {
    this.pushToMuteKeyPressed = enabled;
    if (this.pushToMute) {
      this.setMediaState({
        audio_enabled: this.effectiveAudioEnabled,
        video_enabled: this.video,
      });
    }
  }
  public setPushToMute(enabled: boolean) {
    this.pushToMute = enabled;
    this.setMediaState({
      audio_enabled: this.effectiveAudioEnabled,
      video_enabled: this.video,
    });
  }

  public async applyState() {
    await this.setMediaState({
      audio_enabled: this.effectiveAudioEnabled,
      video_enabled: this.video,
    });
    this.setSound(this.sound);
    this.emitStateUpdate();
  }

  public startObserving() {
    this.controlMutationObserver.disconnect();

    const screenshareBtn = this.screenshareButton;
    if (screenshareBtn) {
      this.controlMutationObserver.observe(screenshareBtn, {
        attributes: true,
        attributeFilter: ['data-kind'],
      });
    }
    const spotlightBtn = this.spotlightButton;
    if (spotlightBtn) {
      this.controlMutationObserver.observe(spotlightBtn, {
        attributes: true,
      });
    }

    this.onControlMutation();
  }

  public applySound() {
    this.setSound(this.sound);
  }

  private setMediaState(state: ElementMediaStatePayload) {
    const isDuplicate =
      this.lastSentMediaState?.audio_enabled === state.audio_enabled &&
      this.lastSentMediaState?.video_enabled === state.video_enabled;

    if (isDuplicate) return Promise.resolve();

    return this.call.transport
      .send(ElementWidgetActions.DeviceMute, state)
      .then(() => {
        this.lastSentMediaState = {
          audio_enabled: state.audio_enabled,
          video_enabled: state.video_enabled,
        };
      })
      .catch(() => undefined);
  }

  private setSound(sound: boolean): void {
    const callDocument = this.iframe.contentDocument ?? this.iframe.contentWindow?.document;
    if (callDocument) {
      callDocument.querySelectorAll('audio').forEach((el) => {
        // eslint-disable-next-line no-param-reassign
        el.muted = !sound;
      });
    }
  }

  public onMediaState(evt: CustomEvent<ElementMediaStateDetail>) {
    const { data } = evt.detail;
    if (!data) return;

    const state = new CallControlState(
      (this.pushToTalk || this.pushToMute) ? this.microphone : (data.audio_enabled ?? this.microphone),
      data.video_enabled ?? this.video,
      this.sound,
      this.screenshare,
      this.spotlight
    );

    this.state = state;
    this.emitStateUpdate();

    if (this.pushToTalk || this.pushToMute) {
      const desiredAudioEnabled = this.effectiveAudioEnabled;
      const currentAudioEnabled = data.audio_enabled ?? this.microphone;
      const currentVideoEnabled = data.video_enabled ?? this.video;

      // Avoid echo-loop resend when the widget already reflects the desired state.
      if (currentAudioEnabled !== desiredAudioEnabled || currentVideoEnabled !== this.video) {
        this.setMediaState({
          audio_enabled: desiredAudioEnabled,
          video_enabled: this.video,
        });
      }
    }

    if (this.microphone && !this.sound) {
      this.toggleSound();
    }
  }

  public onControlMutation() {
    const screenshare: boolean = this.screenshareButton?.getAttribute('data-kind') === 'primary';
    const spotlight: boolean = this.spotlightButton?.checked ?? false;

    this.state = new CallControlState(
      this.microphone,
      this.video,
      this.sound,
      screenshare,
      spotlight
    );
    this.emitStateUpdate();
  }

  public toggleMicrophone() {
    this.state = new CallControlState(
      !this.microphone,
      this.video,
      this.sound,
      this.screenshare,
      this.spotlight
    );

    this.emitStateUpdate();

    return this.setMediaState({
      audio_enabled: this.effectiveAudioEnabled,
      video_enabled: this.video,
    });
  }

  public toggleVideo() {
    const payload: ElementMediaStatePayload = {
      audio_enabled: this.effectiveAudioEnabled,
      video_enabled: !this.video,
    };
    return this.setMediaState(payload);
  }

  public toggleSound() {
    const sound = !this.sound;

    this.setSound(sound);

    const state = new CallControlState(
      this.microphone,
      this.video,
      sound,
      this.screenshare,
      this.spotlight
    );
    this.state = state;
    this.emitStateUpdate();

    if (!this.sound && this.microphone) {
      this.toggleMicrophone();
    }
  }

  public toggleScreenshare() {
    this.screenshareButton?.click();
  }

  public toggleSpotlight() {
    if (this.spotlight) {
      this.gridButton?.click();
      return;
    }
    this.spotlightButton?.click();
  }

  public toggleReactions() {
    this.reactionsButton?.click();
  }

  public toggleSettings() {
    this.settingsButton?.click();
  }

  public dispose() {
    this.controlMutationObserver.disconnect();
  }

  private emitStateUpdate() {
    this.emit(CallControlEvent.StateUpdate);
  }
}