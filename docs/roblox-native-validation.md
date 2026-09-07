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
- Green phase: session transitions, stale responses, duplicate requests, independent players, uncertain outcomes, UTF-8 segmentation, narration ownership, generator structure, no default key embedding, and Lua syntax pass using Python unittest and Lua through lupa.
- Lua compilation through lupa is an additional syntax check; it is not Roblox engine execution. The modules deliberately use the common Lua subset.
- The real server handlers execute against controlled engine/HTTP doubles: live timeout does not invoke offline drawing, replay makes no second backend call or quota use, distance rejection works, and no private reading text reaches the public board or broadcast remote.
- The real client controller executes against presentation doubles: deliberate activation sends once, a result arriving while away pauses, resume/replay/next reuse content, Finish clears it, and definitive rejection is not later overwritten by the request timer.
- Generated artifact matches current sources, has unique XML references, and contains no credential attribute or test runner in the normal build.
- Final local verification: eight Python/Lua checks pass; 19 existing Roblox backend Vitest tests pass in the isolated worktree. The generated place is approximately 209 KB. No runtime checkbox below is implied by these counts.
- View-blocking correction: the reading bubble is now a compact side-offset panel (286×286 desktop, 248×258 compact), with `AlwaysOnTop=false`, a bounded distance, and the page kept in the camera’s center. Eleven Python/Lua checks pass after rebuilding the place.

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

Release status: candidate implementation and generated place available; Studio acceptance not yet run. No merge or publication performed.

## Visibility correction after user feedback

The original native candidate retained a screen Lectio button and spawned the reader 94 studs from the altar. The revised build removes that screen button, moves spawn beside the Bible, adds visible cover lettering, a spine, back cover and gilded page edges, and supports cover click/tap alongside the touch prompt. Secondary options are a separate in-world prompt. A new generator test fails on the original distant spawn and passes on the corrected arrival layout. Nine local checks now pass.

The updated Windows computer-use package was discovered and initialized for Studio inspection, but its node tool returned `failed to write kernel assets: The system cannot find the path specified (os error 3)`. No screenshot or Studio interaction was obtained; visual claims remain unverified.

## Execution deviations

Reflection/summary correction: normal pages now include reflection, and the final page includes the reading summary. Summary can be opened from any page; missing AI content becomes a clearly labeled reflection prompt and reading recap. Ten local checks pass, including preserving live text and Chinese fallback states. A separate ignored `src/roblox/Lectio-Live.test.rbxlx` uses the original workspace's existing backend key and enables HTTP. A verified-TLS read-only library request returned HTTP 200, `ok=true`, and 151 verses. This verifies authentication and connectivity, not an actual charged AI draw or Studio rendering. The live file is private and is not staged or committed.

The approved plan's first task asks for real audio/rig feasibility in Studio before audio integration. That verification is blocked by the lack of a connected Studio tool. To prepare a concrete artifact for testing, the implementation includes the documented audio driver and gesture candidates, with explicit unavailable-audio handling. This is not a claim that the first task's runtime gate passed. All visual/audio/device acceptance remains unchecked above.
