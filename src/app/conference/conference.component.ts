import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AgoraClient, ClientEvent, NgxAgoraService, Stream, StreamEvent } from 'ngx-agora';
import { Subscription } from 'rxjs';
import { FormControl, FormGroup } from '@angular/forms';
import { Location } from '@angular/common';

interface Notify {
  mediaDenied: boolean;
  remoteLeft: boolean;
  waiting: boolean;
  ongoingMeeting: boolean;
}

@Component({
  selector: 'app-conference',
  templateUrl: './conference.component.html',
  styleUrls: ['./conference.component.scss']
})
export class ConferenceComponent implements OnInit, OnDestroy {
  private subscriptions = new Subscription();
  localCallId = 'agora_local';
  streamRemoteCalls: string[] = [];
  joinCode = '';
  joinedMeeting = null;
  muteAudio = false;
  muteVideo = false;
  meetingDetails = '';

  notify: Notify = {
    mediaDenied: null,
    remoteLeft: null,
    waiting: true,
    ongoingMeeting: null,
  }

  form = new FormGroup({
    joinCodeField: new FormControl(''),
    nameField: new FormControl(''),
  });

  private client: AgoraClient;
  private localClientStream: Stream;
  private uid = Math.floor(Math.random() * 100);

  constructor(
    private ngxAgoraService: NgxAgoraService,
    private route: ActivatedRoute,
    private location: Location,
  ) { }

  ngOnInit() {
    this.subscriptions.add(
      this.route.params.subscribe((params) => {
        this.joinCode = params.code;
      }),
    );

    this.subscriptions.add(
      this.route.queryParams.subscribe((params) => {
        this.meetingDetails = params['details'] ? atob(params['details']) : '';
      }),
    );
  }

  ngOnDestroy(): void {
    if (this.joinedMeeting) {
      this.leaveMeeting();
    }
    this.subscriptions.unsubscribe();
  }

  joinMeeting() {
    if (!this.joinCode && !this.form.value.joinCodeField) {
      return;
    }
    if (!this.form.value.nameField) {
      this.form.controls.nameField.setValue('You');
    }
    this.joinCode = this.form.value.joinCodeField ? this.form.value.joinCodeField : this.joinCode;
    this.joinedMeeting = true;
    this.notify.ongoingMeeting = false;
    this.initiateMeeting();
  }

  initiateMeeting() {
    this.client = this.ngxAgoraService.createClient({ mode: 'rtc', codec: 'h264' });
    this.assignAllHandlersForClient();

    this.localClientStream = this.ngxAgoraService.createStream({ streamID: this.uid, audio: true, video: true, screen: false });
    this.assignHandlersForLocalStream();
    this.initializeLocalStream(() => this.join(uid => this.publish(), error => console.error(error)));
  }

  // connect to an online chat room
  join(onSuccess?: (uid: number | string) => void, onFailure?: (error: Error) => void): void {
    this.client.join(null, this.joinCode, this.uid, onSuccess, onFailure);
  }

  // upload the created local stream to chat room.
  publish(): void {
    this.client.publish(this.localClientStream, err => console.log('localStream error: ' + err));
  }

  leaveMeeting() {
    this.leave();
    this.localClientStream.close();
    this.streamRemoteCalls = [];
    this.form.controls.nameField.setValue('');
    this.joinCode = '';
    this.joinedMeeting = false;
    this.notify.ongoingMeeting = null;
    this.notify.remoteLeft = null;
    this.notify.waiting = true;
    this.notify.mediaDenied = false;
    this.location.go('/conference');
  }

  leave() {
    this.ngxAgoraService.client.leave(() => {
      console.log("Leavel channel successfully");
    }, (err) => {
      console.log("Leave channel failed");
    });
  }

  toggleAudio() {
    this.muteAudio ? this.localClientStream.unmuteAudio() : this.localClientStream.muteAudio();
    this.muteAudio = !this.muteAudio;
  }

  toggleVideo() {
    this.muteVideo ? this.localClientStream.unmuteVideo() : this.localClientStream.muteVideo();
    this.muteVideo = !this.muteVideo;
  }

  private assignHandlersForLocalStream(): void {
    this.localClientStream.on(StreamEvent.MediaAccessAllowed, () => {
      this.notify.mediaDenied = false;
      console.log('accessAllowed');
    });

    this.localClientStream.on(StreamEvent.MediaAccessDenied, () => {
      this.notify.mediaDenied = true;
      console.log('accessDenied');
    });
  }

  private assignAllHandlersForClient(): void {
    this.client.on(ClientEvent.LocalStreamPublished, evt => {
      console.log('Publish localStream');
    });

    this.client.on(ClientEvent.PeerLeave, evt => {
      const stream = evt.stream as Stream;
      if (stream) {
        stream.stop();
        this.streamRemoteCalls = this.streamRemoteCalls.filter(call => call !== `${this.getRemoteStreamId(stream)}`);
        this.notify.remoteLeft = true;
        console.log(`${evt.uid} left this channel`);
      }
    });

    this.client.on(ClientEvent.Error, error => {
      console.log('Got error :', error.reason);
      if (error.reason === 'DYNAMIC_KEY_TIMEOUT') {
        this.client.renewChannelKey(
          '',
          () => console.log('Renewed channel key'),
          renewError => console.error('Renew channel failed: ', renewError)
        );
      }
    });

    this.client.on(ClientEvent.RemoteStreamAdded, evt => {
      const streamRemote = evt.stream as Stream;
      this.client.subscribe(streamRemote, { audio: true, video: true }, err => {
        this.notify.waiting = true;
        console.log('remote subscribe failed', err);
      });
    });

    this.client.on(ClientEvent.RemoteStreamRemoved, evt => {
      const streamRemote = evt.stream as Stream;
      if (streamRemote) {
        streamRemote.stop();
        this.streamRemoteCalls = [];
        this.notify.remoteLeft = true;
        console.log(`Remote stream removed ${streamRemote.getId()}`);
      }
    });

    this.client.on(ClientEvent.RemoteStreamSubscribed, evt => {
      const streamRemote = evt.stream as Stream;
      const id = this.getRemoteStreamId(streamRemote);

      if (!this.streamRemoteCalls.length) {
        this.streamRemoteCalls.push(id);
        setTimeout(() => streamRemote.play(id), 1100);

        this.notify.remoteLeft = false;
        this.notify.waiting = false;
        console.log(`${id} joined this channel`);
      } else {
        this.leaveMeeting();
        // override below two props
        this.notify.ongoingMeeting = true;
        this.joinedMeeting = null;
      }
    });
  }

  private getRemoteStreamId(stream: Stream): string {
    return `id: ${stream.getId()}`;
  }

  private initializeLocalStream(onSuccess?: () => any): void {
    this.localClientStream.init(
      () => {
        this.localClientStream.play(this.localCallId);
        if (onSuccess) {
          onSuccess();
        }
      },
      err => console.error('getUserMedia failed', err),
    );
  }
}
