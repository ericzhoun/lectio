# Native reading validation

Implementation workspace: `D:/workplace/lectio-native-reading`, branch `codex/roblox-native-reading`.

## Feasibility evidence — 2026-09-06

Roblox Studio is installed locally. This agent session has no connected Studio execution tool and native computer interaction is disabled. No Studio playtest or audible playback has been observed. Runtime acceptance remains NOT RUN, not passed.

Primary sources inspected:

- [AudioTextToSpeech](https://create.roblox.com/docs/reference/engine/classes/AudioTextToSpeech): `Text`, string `VoiceId`, `LoadAsync`, `Play`, `Pause`, `TimePosition`, and `Ended` support the candidate driver.
- [AudioDeviceOutput](https://create.roblox.com/docs/reference/engine/classes/AudioDeviceOutput): direct device output with a Player target. Local objects avoid public positional speech.
- [Roblox TTS release announcement](https://devforum.roblox.com/t/build-more-immersive-experiences-text-to-speech-api-full-release/3986607): lists Mandarin support in addition to English.
- [Audio objects](https://create.roblox.com/docs/audio/objects): documents a 300-character request limit. Implementation uses complete UTF-8 chunks of at most 180 characters.
- [IKControl](https://create.roblox.com/docs/reference/engine/classes/IKControl): position target, chain root and end effector support a candidate R15 hand reach. R6 uses an interruptible shoulder gesture.

The speech driver implements the documented API as a candidate, not a verified target-experience audio path. Voice permissions, rate limits, exact Mandarin pronunciation, multiplayer privacy, and rig alignment need real Studio verification. No audio assets have been uploaded, no experience configuration changed, and no experience published.

## Automated checks

- Baseline: existing Roblox backend suite passed, 19 tests.
- Red phase: new behavioral/generator tests failed because session modules and a safe build entry point did not exist.
- Green phase: session transitions, stale responses, duplicate requests, independent players, uncertain outcomes, UTF-8 segmentation, narration ownership, generator structure, no default key embedding, and Lua syntax pass using Python unittest and Lua 5.4 through lupa.
- Lua 5.4 compilation is an additional syntax check; it is not Roblox engine execution. The modules deliberately use the common Lua subset.

## Required Studio acceptance checklist

- [ ] Open the generated place without overwriting another open Studio place.
- [ ] Run test build with `--include-tests` and confirm NativeTests assertions.
- [ ] Two players: simultaneous touch, different verses/languages, private narration and bubbles, generic public board.
- [ ] R6 and R15, short/tall avatars: hand contact or graceful fallback; move/respawn during reach.
- [ ] Actual English and Mandarin playback matches displayed text; long passages, pause, replay, missing audio, and mute.
- [ ] Daily/Divina/Deep/calendar readings retain their distinct quota behavior.
- [ ] Keyboard, controller, and touch: ribbons, page stack, text segments, settings, finish/resume.
- [ ] Leave during loading and reading; return/resume; repeated activation; quota rejection and live timeout.
- [ ] Reduced motion, small-screen layout, page flight and camera cleanup.

Release status: implementation in progress; Studio acceptance not yet run.
