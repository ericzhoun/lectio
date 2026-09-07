# Roblox Native Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player touch a physical Bible and privately read and hear flying scripture pages inside the shared chapel.

**Architecture:** Preserve existing content services and secondary interfaces. Introduce small Lua modules for session state, world presentation, interaction, narration, and server request lifecycle; generate them into the existing place. Keep reading content and presentation private, replicating only validated avatar activity.

**Tech Stack:** Existing Roblox Luau, Python place generator, Astro/TypeScript backend, Vitest backend tests, Roblox Studio multiplayer verification.

**Spec:** `docs/superpowers/specs/2026-09-06-roblox-native-reading-design.md`

## Global Constraints

- Players share a chapel but receive private pages, verse bubbles, and narration.
- Walking past or colliding with the book never initiates a draw.
- Replay, previous-page navigation, pause, and resume do not consume a reading.
- Narration mute is independent of chapel music. Text remains usable without sound.
- Existing website audio URLs must not be assumed playable inside Roblox.
- Static validation alone does not prove runtime acceptance.
- Work on an isolated `codex/` branch at execution time. Do not publish the experience as part of local implementation.
- Never commit a generated place containing a real LectioApiKey. The current generator reads credentials automatically; add explicit opt-in embedding before regenerating a tracked place.

## File map and contracts

Create under `src/roblox/modules/`:

| File | Responsibility |
| --- | --- |
| `ReadingSession.lua` | Pure session transitions, selected page, pending request, retained reading |
| `DrawRequests.lua` | Server per-player request cache and in-flight/uncertain protection |
| `BibleInteraction.lua` | Prompts, ribbons, reach gesture, distance changes |
| `BiblePresentation.lua` | Local Bible copy, pages, bubbles, controls, camera and cleanup |
| `Narration.lua` | Verified audio driver, single playback ownership, callbacks |

Create `src/roblox/tests/run.lua` for Studio assertions and `src/roblox/tests/test_generate_lectio.py` for generator tests. Test modules are packaged only in an explicit test build. Create `docs/roblox-native-validation.md` for actual feasibility and runtime evidence. Modify `src_client.lua`, `src_server.lua`, `generate_lectio.py`, and `HANDOVER.md`; rebuild `Lectio.rbxlx` only after the safe generator change. Backend changes are not needed for the conservative no-retry-on-uncertainty policy below.

Shared value contracts (Lua tables, no new dependency):

```lua
-- Verse: {refEn, refZh, textEn, textZh, interp?, positionEn?, positionZh?}
-- Reading: {verses: {Verse}, labels: {string}, title: string,
--           summary: string, topic: string, mode: string}
-- Session snapshot: {phase: string, requestId: string?, reading: Reading?,
--                    page: number, lang: "en"|"zh", near: boolean}
-- phase: idle, reaching, loading, revealing, reading, paused, closing, failed, uncertain
-- Draw result envelope: {requestId: string, status: "complete"|"rejected"|"uncertain",
--                        response: table?}
```

Each task ends by staging only its listed changed files and committing with the supplied message. Run behavioral tests before implementation to establish a failing baseline; use Studio for engine-dependent tests rather than pretending Python validates Roblox behavior.

### Task 1: Resolve narration and reach feasibility

**Files:** Create `docs/roblox-native-validation.md`. Read existing `scripts/tts/`, `src_verse_data.lua`, and live reading response shapes. Keep experimental objects in an untracked Studio test place.

**Interfaces:** Produce a verified narration driver decision with exact documented API calls, language/text limits, permission prerequisites, and real playback evidence; produce supported rig reach strategy and cleanup behavior. These decisions are inputs to Tasks 4 and 5, not assumed facts.

- [ ] Inspect available Studio access and installed tools. Check current official Roblox documentation for audio playback, speech generation availability, experience permissions, animation, and rig support; record direct source links and verification date.
- [ ] Prefer a supported speech path accepting the exact verse text if it works for both English and Chinese. Test one actual verse per language, a long passage, pause, stop, and two separate clients. Do not equate an API description with successful playback.
- [ ] If speech is unavailable, verify experience-permitted uploaded recordings. Specify a lookup keyed by exact text and language, including offline translations and calendar passages; do not use a recording from another translation. Record any necessary upload/configuration as a concrete external prerequisite.
- [ ] Test a visible hand reach on R6 and R15, plus differing avatar heights. Record an interruptible fallback gesture for unreachable contact and verify leaving/respawning restores control.
- [ ] Record PASS, FAIL, or NOT RUN for each probe with the actual environment. If audio cannot be verified, mark audio-dependent implementation blocked; independent session and generator tasks can proceed. Do not ship a silent feature under a narration claim.
- [ ] Commit the evidence: `docs: record Roblox narration and avatar feasibility`.

### Task 2: Session state and request lifecycle

**Files:** Create `modules/ReadingSession.lua`, `modules/DrawRequests.lua`, and `tests/run.lua` under `src/roblox/`.

**Interfaces:** `ReadingSession.new()` returns an object with `dispatch(event)` and `snapshot()`. Events are `begin{id}`, `contact`, `received{id,reading}`, `revealed`, `near{value}`, `select{page}`, `language{lang}`, `pause`, `resume`, `finish`, `closed`, `failure{id,uncertain}`, and `respawn`. `DrawRequests.new()` exposes `begin(playerId,id) -> "start"|"pending"|"cached"|"blocked", result?`, `complete(playerId,id,result)`, `uncertain(playerId,id)`, and `remove(playerId)`.

- [ ] Add this failing behavioral test to the Studio runner:

```lua
local s = ReadingSession.new()
s:dispatch({type="begin", id="a"})
s:dispatch({type="contact"})
s:dispatch({type="near", value=false})
s:dispatch({type="received", id="a", reading={verses={{textEn="one"},{textEn="two"}}}})
assert(s:snapshot().phase == "paused")
assert(#s:snapshot().reading.verses == 2)
s:dispatch({type="received", id="old", reading={verses={}}})
assert(#s:snapshot().reading.verses == 2)
s:dispatch({type="select", page=2})
assert(s:snapshot().page == 2)
s:dispatch({type="respawn"})
assert(s:snapshot().page == 2 and s:snapshot().phase == "paused")
local q = DrawRequests.new()
assert(q:begin(1,"a") == "start")
assert(q:begin(1,"a") == "pending")
assert(q:begin(1,"b") == "blocked")
q:uncertain(1,"a")
assert(q:begin(1,"a") == "blocked")
assert(q:begin(1,"b") == "blocked")
assert(q:begin(2,"a") == "start")
```

- [ ] Run it in Studio with the modules absent; confirm the missing-module failure, then create the modules and rerun for behavioral failures.
- [ ] Implement pure transitions. `received` accepts only the current request and retains a result while away. `respawn` retains content and pauses. `select` clamps to existing pages. `finish` clears content only on `closed`; a pending request cannot be discarded to start another. Explicit Resume is required after returning; proximity alone never plays audio. `resume` requires near=true and retained content, then enters reading; `pause` enters paused without deleting content.
- [ ] Implement the request cache: completed matching IDs replay their result, active/uncertain requests reject new IDs, and different players remain independent. Keep a bounded completed cache of 16 results per player; retain the active/uncertain entry separately. Reject reused completed IDs with changed parameters at the server adapter.
- [ ] Add assertions for cached result identity, page bounds, language changes, and finish cleanup. Run the Studio test runner successfully.
- [ ] Commit: `feat: add personal reading session and draw lifecycle`.

### Task 3: Safe generated Bible assets and module packaging

**Files:** Modify `src/roblox/generate_lectio.py`; create `src/roblox/tests/test_generate_lectio.py`.

**Interfaces:** Generate `Workspace.AltarBible` as the stable prompt anchor and `Workspace.BibleVisual` as a Model with `CoverLeft`, `CoverRight`, `PageBlock`, `Contact`, `PageDestination`, `RibbonDaily`, `RibbonDivina`, and `RibbonDeep`. Package client modules in `ReplicatedStorage.LectioModules`; package `DrawRequests` server-side. Preserve existing VerseData placement.

- [ ] Add generator tests using Python unittest and XML parsing. Refactor a pure `build_document(embed_key=False, include_tests=False)` returning XML so tests do not overwrite the place. Start with:

```python
def test_default_build_has_no_secret(self):
    with patch.object(generator, 'load_api_key', return_value='test-secret-marker'):
        xml = generator.build_document()
    self.assertNotIn('test-secret-marker', xml)
    self.assertNotIn('AttributesSerialize', xml)

def test_bible_has_required_parts(self):
    root = ET.fromstring(generator.build_document())
    names = {n.text for n in root.findall('.//string[@name="Name"]')}
    self.assertTrue({'AltarBible','BibleVisual','Contact','PageDestination',
                     'RibbonDaily','RibbonDivina','RibbonDeep'} <= names)
```

- [ ] Run `python -m unittest discover -s src/roblox/tests -p "test_*.py"`; confirm failure before implementing.
- [ ] Build the named model with independent cover/page pivots and noncolliding presentation parts. Keep the prompt anchor at the existing altar position. Add explicit `--embed-api-key` and `--include-tests` switches; neither defaults on. Add module packaging and a disabled-by-default Studio runner.
- [ ] Rerun Python tests and parse generated XML. In Studio inspect cover pivots, prompt reach, page destination, and ribbons at the altar.
- [ ] Commit: `feat: generate articulated Bible and reading modules safely`.

### Task 4: Private page presentation and narration

**Files:** Create `src/roblox/modules/BiblePresentation.lua` and `Narration.lua`; extend `src/roblox/tests/run.lua`.

**Interfaces:** `BiblePresentation.new(anchors,onAction)` returns `render(snapshot,settings)`, `setAudioState(state)`, and `destroy()`. `onAction` supplies `next`, `previous`, `select{page}`, `replay`, `pause`, `resume`, `finish`, or `segment{index}`. Settings are `{reducedMotion:boolean, narrationMuted:boolean}`. `Narration.new(driver,onState)` returns `play(verse,lang)`, `pause()`, `resume()`, `stop()`, `destroy()`. Driver exposes `start(text,lang,onState) -> playback`; playback exposes `pause()`, `resume()`, `stop()`. Task 1 supplies the verified concrete driver implementation inside Narration.

- [ ] Add a fake-driver test proving stale playback is stopped before another starts:

```lua
local stopped = 0
local driver = {start=function(text,lang,callback)
    return {pause=function() end, resume=function() end,
            stop=function() stopped=stopped+1 end}
end}
local n = Narration.new(driver,function() end)
n:play({textEn="first"},"en")
n:play({textZh="第二"},"zh")
assert(stopped == 1)
n:destroy()
assert(stopped == 2)
```

- [ ] Run the failing test. Implement single-owner playback with generation tokens so a late completion cannot affect a new verse. Empty/missing text reports unavailable; switching language stops prior audio and waits for explicit play.
- [ ] Implement local Bible clone and locally hidden static visual, finite opening/flutter/reveal animations, floating selected page, reference, progress, and collapsed completed stack. Use private BillboardGui-style bubbles attached to the page; do not send content through public chat.
- [ ] Segment complete text at punctuation where possible and by UTF-8 characters for long runs. Provide explicit segment progression when timed audio segments are unavailable. Never cut Chinese byte sequences. Place reflections under a separate label and expose summary on completion.
- [ ] Bind page actions through `onAction`; Next never calls a remote. Reduced motion uses fades and leaves the camera alone. `destroy()` restores original local visibility/camera values and disposes connections, tweens, pages, and sounds.
- [ ] Run fake-driver tests and Studio checks for long English/Chinese text, ten pages, interrupted animation, missing audio, repeated destroy, and camera cleanup. Demonstrate real playback with the Task 1 driver.
- [ ] Commit: `feat: present private flying pages with verse narration`.

### Task 5: Deliberate touch and private multiplayer requests

**Files:** Create `src/roblox/modules/BibleInteraction.lua`; modify `src/roblox/src_server.lua`; extend `src/roblox/tests/run.lua`.

**Interfaces:** `BibleInteraction.new(anchors,onAction)` exposes `setEnabled(boolean)`, `reach(onContact)`, and `destroy()`. Actions are `activate`, `mode{mode}`, and `near{value}`. Extend `LectioExplore` with trailing `requestId`; respond with the envelope defined above. Add `LectioActivity` carrying only a validated player identity and activity type, never reading content. Today's reading uses the same request identity envelope with its existing free endpoint.

- [ ] Reproduce the existing timeout-to-offline behavior with a stub backend and a countable offline draw. Define the required assertion:

```lua
-- Server adapter test seam: executeDraw calls one injected backend or offline function.
local calls = {live=0, offline=0}
local result = DrawRequests.executeDraw("live",function()
    calls.live=calls.live+1
    return {kind="uncertain"}
end,function() calls.offline=calls.offline+1 end)
assert(result.kind == "uncertain")
assert(calls.live == 1 and calls.offline == 0)
```

- [ ] Define `executeDraw(mode,backend,offline)` as a testable function in `DrawRequests`: `offline` mode invokes offline exactly once; `live` invokes backend once and passes through its tagged result. Backend tags are `complete{response}`, `rejected{response}`, or `uncertain`. Test failure before integrating.
- [ ] Integrate request lifecycle validation before any yield: validate ID length/type, mode, player distance, and entitlement inputs; allow only the latest active request. Cache result envelopes. Remove per-player entries on departure. Rate-limit public activity and never broadcast arbitrary client payloads.
- [ ] For explore only, replace ambiguous nil transport results with tagged outcomes. Preconfigured offline mode remains supported. Once a live request is sent, a timeout, malformed response, or unclassified failure becomes uncertain and cannot trigger offline fallback or automatic retry. Keep that player's draw blocked for the server session with localized explanatory text; known business rejection is retryable. Other endpoints retain existing behavior unless needed for this flow.
- [ ] Remove personal `updateBoard` calls and replace the board with general chapel information. Validate that no reader name or verse is broadcast elsewhere.
- [ ] Implement cross-device prompts and private ribbon selection. Use the Task 1 reach strategy; replicate only approved avatar reach/glow. Require explicit activation and cancel the gesture safely on departure or character replacement.
- [ ] Run Studio server tests for simultaneous players, duplicate IDs, out-of-range activation, timeout, offline mode, and no shared reading text. Run `npm test -- src/lib/__tests__/roblox-api.test.ts` to confirm backend behavior remains intact.
- [ ] Commit: `feat: connect physical Bible interaction to private draws`.

### Task 6: Integrate reading flow and preserve secondary features

**Files:** Modify `src/roblox/src_client.lua`; extend `src/roblox/tests/run.lua`.

**Interfaces:** Client composition owns one instance of each module. Normalize both explore `verses` and today `steps` into the Reading contract. Keep existing quota state updates, language settings, library, assistant, registration, and calendar hooks.

- [ ] Establish a Studio failure case: spawn currently opens the landing panel and Explore opens the reading panel. The new expected behavior is an unobstructed spawn and world page presentation after touch.
- [ ] Wire interaction actions to session events. Generate one request ID per deliberate draw. Contact dispatches loading and sends the request once. Received envelopes update quotas and normalize content; cached/resumed content bypasses networking. After a failed or uncertain result, restore camera and show the specified localized state.
- [ ] Replace primary landing/reading panel entry points with world interaction. Keep a compact optional intention input and existing secondary windows. Today's reading selects the free endpoint and renders its normalized pages. Do not silently change it into a charged draw.
- [ ] Derive assistant reading context from the active session instead of `ui.reading.Visible`. Preserve the returned reflection language and show its label separately from scripture.
- [ ] Wire narration mute and reduced motion into existing Settings in both languages. Bind Next, previous, Replay, Pause, Resume, Finish, and text-segment actions to their owning controller. Keep controls controller-selectable and touch-sized.
- [ ] On distance exit pause audio and presentation. On return show Resume without auto-play. Character replacement destroys visual objects and rebinds anchors while retaining session data; Finish clears the completed session after closing.
- [ ] Run the Studio test runner and manual journeys: all three modes; today; EN/Chinese toggle; assistant context; registration; library; leave during loading; respawn; replay and resume. Check that only deliberate fresh draws reach the server.
- [ ] Commit: `feat: make native Bible reading the primary chapel flow`.

### Task 7: Rebuild, multiplayer acceptance, and handover

**Files:** Modify `src/roblox/Lectio.rbxlx`, `src/roblox/HANDOVER.md`, and `docs/roblox-native-validation.md`.

**Interfaces:** Deliver a secret-free generated place and evidence against all eight acceptance criteria in the approved specification.

- [ ] Run `python -m unittest discover -s src/roblox/tests -p "test_*.py"` and `npm test -- src/lib/__tests__/roblox-api.test.ts`. Run Studio module assertions using a test build. Record actual failures and fix them before claiming completion.
- [ ] Run `python src/roblox/generate_lectio.py` without credential embedding or test packaging. Parse the output XML and verify the shipped artifact contains neither test runner nor credential attribute. Compile/load all changed Lua scripts in Studio; generator XML validation alone does not check Lua execution.
- [ ] Run a two-player Studio session: select different modes/languages, overlap reach/reveal, navigate independently, verify private bubbles/audio and generic board. Confirm one player leaving does not affect the other's page or narration.
- [ ] Run touch-device and controller emulation plus keyboard; check long text, ten-page navigation, reduced motion, mute, unavailable audio, live failure, offline draw, quota rejection, and respawn. Record actual tested rig/device combinations.
- [ ] Record real bilingual narration evidence and matching text in the target experience. If access/assets prevent this, mark the release incomplete and state the concrete missing prerequisite, without fabricating PASS results.
- [ ] Update HANDOVER with the new primary flow, module ownership, safe regeneration, audio setup, session-only bookmark behavior, and uncertain-request limitation. Remove stale statements claiming the main panel appears on spawn or the board shows personal verses.
- [ ] Run `git diff --check`, review the changed artifact and source list, and commit: `feat: deliver verified native Roblox reading place` only when the required runtime checks pass. Otherwise commit only accurately labeled partial work and report the outstanding gate.

## Plan review

Coverage: approach/ribbons/reach are Tasks 3 and 5; private pages/bubbles/voice are Tasks 1 and 4; pause/resume/request identity are Tasks 2, 5, and 6; secondary features and language are Task 6; cleanup, accessibility, quotas, multiplayer privacy, and real audio acceptance are Tasks 4–7. The implementation must resolve the Task 1 platform-dependent audio decision from evidence before audio integration. This plan does not claim that feasibility or runtime checks have already passed.
