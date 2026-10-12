# Session Maker native audio

Windows Session Maker playback uses `vsthost session`: assets are uploaded once,
and a persistent mixer renders directly to the default Windows multimedia output
through shared-mode WASAPI at 48 kHz. The renderer sends transport and mix commands,
not audio blocks. Plugin edits forward normalized parameter changes immediately;
saved state still goes to project history and handles presets/undo.

The mixer supports clip offsets, pitch/speed-prepared buffers, fades, comp silences,
mute/solo, pan, built-in effects/sends, reference A/B, loops, and plugin latency
compensation. Windows export uses the same DSP through `session-render`. Browser
and other-platform playback retain Web Audio.

The built-in native compressor, limiter, chorus, and reverb are independent DSP
implementations, not bit-identical replacements for Chromium. In particular the
native reverb uses a feedback delay network instead of a randomized convolution.
VST editor windows still use separate controller instances, so their meters do
not monitor the playing lane. Live knob changes reach the playback processor;
preset loads, plugin insertion, and latency/I/O reconfiguration can interrupt
audio briefly. Device removal stops playback with an error; restarting playback
opens the current default device.

## Checks

Build the host with `node scripts/build-vsthost.mjs`. Run the headless bridge,
transport, and mixer checks with:

```
node --test electron/nativeSession.test.js scripts/test-native-transport.mjs scripts/test-native-session.mjs
```

Build the native transport/plugin checks with
`node scripts/build-vsthost.mjs --tests`, then run
`build/vsthost/session-tests.exe`. Optional arguments are a VST3 module path and
class ID; this tests a live output-gain change on the same processor instance
(the plugin must expose an output gain parameter). These tests do not open an
audio device or plugin window.
