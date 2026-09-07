# Roblox native personal reading

Date: 2026-09-06
Status: Interaction and technical design approved in conversation; written specification awaiting review.

## Outcome and scope

Make the avatar's encounter with a physical Bible the primary Lectio reading interface. Players share a chapel but receive private pages, verse bubbles, and narration. The user approved this direction, the interaction sequence, and the technical boundaries before this specification was written.

The first release includes touch initiation, animated Bible opening, flying reading pages, bilingual verse bubbles, narration controls, three reading modes, pause/resume, and reduced motion. Existing registration, assistant, library, settings, and daily-calendar entry points remain accessible. Redesigning those secondary destinations, group readings, persistent reading history, and new monetization are outside scope.

## Existing implementation

- `src/roblox/generate_lectio.py` generates the chapel and packages Lua sources into `Lectio.rbxlx`. The altar Bible is currently static geometry.
- `src/roblox/src_client.lua` presents the landing and reading flows through ScreenGui panels and handles language, reading progression, and secondary features.
- `src/roblox/src_server.lua` handles reading requests, backend integration, fallback content, quotas, and world prompts. It currently broadcasts the first verse and reader name through VerseBoard; personal readings must stop updating that board.
- `src/roblox/src_verse_data.lua` supplies offline bilingual content. Live and offline content can use different translations; audio must match the actual returned text.
- The existing explore and today endpoints remain the content source. The generated place must be rebuilt after source changes.

## Player experience

### Approach and selection

Players spawn into the chapel with movement available and without an automatically opened landing panel. Within reach of the altar, a small Touch Bible prompt appears. Activation supports touch, keyboard, and controller. Walking past or colliding with the book never initiates a draw.

Three physical ribbon bookmarks select Daily Word (one verse, the default), Lectio Divina (three), or Deep Lectio (ten). Selection is private to the player. Existing entitlement checks still apply. An optional compact intention input preserves the existing question/topic feature; it is not required before touching the book. Today's reading remains a distinct free calendar entry point and uses the same page presentation.

### Touch, open, and reveal

Activation starts an avatar reach toward a defined contact point. The book opens at the visual hand-contact moment, pages flutter briefly, and one page lifts from the binding toward a readable position beside the altar. The page remains anchored near the Bible rather than following the player around the chapel.

The reach is a short presentation gesture, not a physics collision requirement. The implementation must accommodate supported avatar rigs and sizes, with a simple reach fallback when exact hand alignment is unavailable. Movement or cancellation must never leave the character or camera locked.

Other players see the reader's reach and a brief altar glow. Each reader sees a personal animated Bible presentation, replacing the static Bible locally during the encounter. Shared book geometry does not animate according to one reader's state. Multiple readers can activate the altar without a global queue or lock.

### Read and continue

A talking bubble anchored above the floating page presents the verse in short readable portions. The page retains the scripture reference and position in the reading. Narration speaks the same scripture text and language. Bubbles are personal reading presentation, not public player chat.

Replay, Pause, Next, and Finish controls sit beside the page and remain usable with touch and controller navigation. Progression is explicit; finishing narration does not automatically draw or advance. Selecting Next reveals the following page from the same reading. Completed pages gather into a small floating stack; selecting one revisits it without requesting another draw. Only the selected page has an expanded bubble, preventing ten-page readings from filling the view with text.

AI reflections remain available as a separately labeled reflection on the selected page, with the reading summary available at completion. They must not be presented as scripture or silently included in scripture narration.

### Pause and finish

Walking beyond the interaction area pauses narration, dismisses expanded bubbles, and folds the presentation into a bookmark. Returning offers Resume reading. The bookmark stores the current reading and page for the current server session; respawning retains that session reading and offers resume after returning to the altar. Leaving the server does not promise persistent history.

Finish returns the pages to the Bible and closes it. A subsequent explicit touch starts a new draw. Replay, previous-page navigation, pause, and resume do not consume a reading. Changing language updates the verse text and restarts narration only on explicit playback; the existing generated reflection remains in its original language unless a separate future feature changes that behavior.

## Component boundaries

1. **Chapel model:** Bible covers, page pivots, ribbons, contact point, and page destination anchors. The generator owns these assets and packages the runtime modules.
2. **Interaction controller:** Input, distance eligibility, ribbon choice, reach gesture, and brief public activity effects. It accepts deliberate activation and delegates reading requests; it does not select verses or own quotas.
3. **Reading session controller:** Owns state, request identity, returned reading, selected page, language, and cancellation. It instructs presentation and narration through explicit start, pause, resume, select, and finish operations.
4. **Bible and page presenter:** Owns local geometry, animations, private bubbles, controls, camera framing, and reduced-motion rendering. It renders supplied content and reports user actions without initiating backend calls directly.
5. **Narration controller:** Resolves matching audio for the supplied passage and language, exposes playback state, and stops stale audio when page or session changes. It owns no draw logic.
6. **Server reading adapter:** Validates player, mode, proximity for altar draws, and request identity; invokes existing reading services and returns results only to the requesting player. Existing quota and entitlement decisions remain authoritative.

Extract focused modules from the current client as necessary for these responsibilities. Do not refactor unrelated assistant, registration, or library internals.

## State and request flow

The normal sequence is Idle → Reaching → Opening/Loading → Revealing → Reading → Closing → Idle. Paused can be entered from an active encounter. A failed request returns to a retryable state with camera and movement restored.

One logical activation receives one request identifier. The server permits one in-flight draw per player and caches its completed result for session retries. Repeated touches cannot create concurrent draws. A retry of the same completed request returns its original result. Any timeout after a potentially charged backend request must not blindly submit another charged draw: implementation must verify backend request deduplication or add it before offering an automatic retry of an uncertain result.

The session controller ignores stale responses for presentation. If the reader leaves the altar while a valid request completes, retain the result for resume rather than discard it and draw again. Pausing loading therefore suppresses the reveal but does not start another request. Respawning cleans up presentation and audio without erasing an already received session result.

Server-side validation governs eligibility; client animation never grants a reading. Public effect events contain only the minimum avatar activity needed to show a reach/glow, never topic, verse, reflection, or audio data. Replace personal VerseBoard updates with general chapel information.

## Narration delivery and synchronization

Audible verse playback is a required release capability. Implementation planning must first verify a supported Roblox audio delivery path in the target experience, including permissions, bilingual coverage, and real playback. Existing website audio URLs must not be assumed playable inside Roblox.

The narration adapter accepts a passage identity, exact text/translation, and language. A verified audio asset mapping or supported speech path may fulfill it. Asset-backed recordings must identify their exact text; an unmatched recording is unavailable rather than an acceptable substitute. Dynamic calendar passages need coverage as well as the fixed draw deck.

Use available segment timing for bubble changes. When precise timing is unavailable, keep readable text visible and use explicit progression rather than claiming word-level synchronization. At most one scripture voice plays for a player. Pause, page changes, departure, respawn, and Finish stop or pause the appropriate playback immediately. Replay never requests content again.

Missing audio displays a localized audio-unavailable indication while preserving the reading. This is an error fallback, not a substitute for demonstrating working narration before release. A discovery that requires uploads or external asset configuration must be recorded in the implementation plan with concrete prerequisites.

## Accessibility and failures

- Keep camera framing brief and interruptible; reduced motion skips camera movement and replaces page flights with gentle fades.
- Maintain readable bubble text, reference visibility, and reachable controls on small screens. Long passages are segmented without truncating scripture.
- Narration mute is independent of chapel music. Text remains usable without sound.
- Slow responses leave the Bible gently open after a short flutter rather than flipping indefinitely.
- Quota or entitlement rejection closes the pending encounter and presents the existing localized reason and available next action.
- Request failures settle the Bible and provide a retry path respecting the request rules above.
- Clear connections, animations, temporary objects, and sounds on finish or character replacement. Cache the session content separately from those presentation objects.

## Verification and acceptance

The release is accepted when:

1. A player can walk up, choose a ribbon, visibly touch the Bible, and receive the correct number of flying pages without opening the old primary reading panel.
2. Two players at the altar receive independent readings, controls, languages, and narration. Neither sees the other's verse, question, or reader attribution on the public board.
3. Repeated activation and request retries cannot produce duplicate charges for one logical draw; previous, replay, and resume make no new draw request.
4. Walking away during loading or narration and respawning restore control, stop presentation appropriately, and permit session resume.
5. Bubbles show complete scripture matching its reference and audible text in both supported languages. Real audio is demonstrated in the target experience; missing audio is separately tested.
6. All three modes and Today's reading use the shared presentation while retaining their existing entitlements and quota behavior.
7. Keyboard, touch, and controller users can initiate, read, replay, advance, and finish. Reduced motion and muted narration remain fully usable.
8. Lua source validation and generated-place XML validation pass, existing relevant backend tests pass, and a Roblox Studio multiplayer playtest confirms animation, privacy, audio, and cleanup. Static validation alone does not prove runtime acceptance.

## Next step

Review this written specification. After approval, use the Superpowers writing-plans workflow to prepare implementation steps, beginning with audio delivery and avatar animation feasibility checks. No experience implementation or publication is part of this specification-writing step.
