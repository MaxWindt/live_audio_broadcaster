# Live Audio Broadcaster

A server which allows audio publishers to broadcast to subscribers on a channel, using nothing more than a modern web browser.

It uses websockets for signalling & WebRTC for audio.

The designed use case is for live events where language translation is happening.
A translator would act as a publisher and people wanting to hear the translation would be subscribers.

## Installation 

Download [Zip folder](https://github.com/MaxWindt/live_audio_broadcaster/archive/refs/heads/main.zip) and unzip

## Custom DNS (optional)

Install [Docker Desktop](https://docs.docker.com/desktop/)

Run in folder
```
docker compose up 
```
Edit Settings under `http://localhost:8084/admin`
## Usage
```
Usage of ./babelcast:
  -port int
    	listen on this port (default 80)
  -webRoot string
    	web root directory (default "html")
```

Then point your web browser to `http://localhost/publisher.html`

If the `PUBLISHER_PASSWORD` environment variable is set, then publishers will be required to enter the
password before they can connect.

## Credit

Thanks to Babelcast and the excellent [Pion](https://github.com/pion/webrtc) library for making WebRTC so accessible.
