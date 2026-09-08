# Handover: Lectio Roblox World (`Lectio.rbxlx`)

**Date:** 2026-09-06
**Author:** Built with ZCode (automated Roblox place generator)
**Native-reading implementation:** `D:\workplace\lectio-native-reading`, branch `codex/roblox-native-reading`.

**Validation status:** Automated checks pass; Roblox Studio visual, audio, input-device, and multiplayer playtests have not been run in the implementation session. See `docs/roblox-native-validation.md` for the exact acceptance checklist. Do not treat generated XML validation as proof of playable behavior.

---

## 1. What this is

A Roblox world that replicates the functionality of **https://enjoyhim.org/** — the **Lectio** daily scripture-reading website — as a playable 3D place. The original `/continuecontinue` path returns HTTP 404; the root site was used as the source of truth.

The deliverable is **`Lectio.rbxlx`**, a standard Roblox place file for Roblox Studio. This version makes the physical Bible the primary reading interface: approach, select a ribbon, touch, then read private flying pages and verse bubbles. Narration uses a client-only candidate Roblox speech driver. The agent has not opened or playtested this generated version in Studio.

### What the original site does (source of truth)

- Visitor brings a question, "flips open the Bible", and receives scripture verses.
- Three reading modes: **Daily Word** (1 verse), **Lectio Divina** (3 verses: reading → reflection → response), **Deep Lectio** (10 verses).
- Usage limits: **3 readings/day** anonymous; **free registration** unlocks **6/day** plus 3 Lectio Divina trial credits and 1 Deep Lectio credit.
- Popular-topic shortcuts, a church-calendar "Today's reading" path, a Verse Library, an "Lectio Assistant" chat, an EN/中文 language toggle, and Settings.
- Disclaimer: contemplative reading, not fortune-telling.

---

## 2. Files in this workspace

| File | Purpose |
|---|---|
| `Lectio.rbxlx` | **The deliverable.** Generated Roblox place (world + scripts). Open in Studio. |
| `generate_lectio.py` | Python generator that builds `Lectio.rbxlx` from the three Lua sources. Re-run after editing any `src_*.lua`. |
| `src_verse_data.lua` | ModuleScript — bilingual (KJV / CUV, both public domain) verse library, topic categories/keywords, 7 weekday "Today's reading" passages, assistant rules. |
| `src_server.lua` | Server Script — RemoteEvents, DataStore-backed daily limits, registration, verse picking, 3D board updates, ProximityPrompts. |
| `src_client.lua` | LocalScript — composes native reading and retains optional intention/menu, library, assistant, registration, settings, and language controls. |
| `modules/ReadingSession.lua` | Pure reading lifecycle, retained session bookmark, page and language. |
| `modules/DrawRequests.lua` | Server request identity, bounded result cache, duplicate/uncertain protection. |
| `modules/BibleInteraction.lua` | Local prompts, ribbon choice, R15 IK/R6 fallback reach, public activity presentation. |
| `modules/BiblePresentation.lua` | Private book copy, flying pages, verse bubbles, page controls, brief camera framing. |
| `modules/Narration.lua`, `SpeechDriver.lua`, `TextSegments.lua` | Single-owner audio, candidate exact-text TTS, complete UTF-8 segments. |
| `modules/NativeReading.lua` | Connects interaction, session, presentation, narration, and existing remotes. |
| `tests/` | Pure Lua/controller/server tests through lupa, generator checks, optional Studio assertions. |

Regenerate the place after editing any source:

```bash
python generate_lectio.py
```

The generator validates the XML is well-formed before writing.

Default generation never reads or embeds the API key. For a private live build, use an explicit untracked output, for example `python generate_lectio.py --embed-api-key --output Lectio.test.rbxlx`. Never commit a credential-bearing build. `--include-tests` packages the Studio assertions; it is off for the normal artifact.

An explicit credential-bearing build also enables HTTP for the backend connection. A private `Lectio-Live.test.rbxlx` has been prepared locally using the existing original-workspace backend configuration; it is ignored by Git. Use that file for AI reflections and summaries. The public/default build remains credential-free and shows labeled reflection prompts and reading recaps when AI content is absent. Reflection appears below scripture; the final page includes summary, and Summary is available from every page.

---

## 3. Feature mapping (site → Roblox)

| Website feature | Roblox implementation |
|---|---|
| Question input ("I want to explore…") | TextBox on the landing panel; empty input falls back to a random popular topic |
| Popular Topics (4 chips) | Four clickable chips that fill the topic box |
| Daily Word / Lectio Divina / Deep Lectio | Three selectable mode cards (1 / 3 / 10 verses) |
| Touch Bible / Explore | Starts one deliberate reach and request near the altar; server selects verses and enforces usage; pages fly from a private Bible copy. |
| Verse display | Private verse bubble above the selected page; reference, stage/progress, replay/pause/resume, previous/next, reflection, and final summary. The public board contains general chapel information only. |
| 3 readings/day, 6/day registered | Server-enforced per-player counters keyed by UTC date, persisted via DataStore `LectioData_v1` (session-memory fallback) |
| "Create free account" registration | Register panel button (and a desk with prompt in the world) sets `registered=true`, grants 6/day + 3 divina + 1 deep trials |
| Church calendar "Today's reading" | Deterministic weekday-picked 3-step passage; free (doesn't consume daily readings) |
| Verse Library | Scrolling GUI list of all verses grouped by 10 topic categories; also reachable via the bookshelf in the world |
| Lectio Assistant chat | Chat window wired to keyword-rule assistant with a 10 messages/day cap |
| EN / 中文 toggle | Full UI + verse re-render in both languages |
| Settings | Separate narration and music toggles, reduced motion, language shortcut. |
| In-world interactivity | Click/tap the Bible cover or use its touch prompt to open and draw. Ribbon prompts select modes. Reading options is a separate in-world prompt; there is no screen Lectio button. |

---

## 4. World layout

Serene chapel garden, with spawn beside the altar at `(0, 2, -45)` facing the Bible:

- **Chapel:** marble floor, 4 columns, wood roof, back wall with 5 neon stained-glass panels, altar with labeled physical Bible (`BibleVisual`), candelights with PointLights.
- **VerseBoard** (20×10, named part at `(0, 15.5, -60.5)`, yaw 180°): server builds a SurfaceGui on its Front face at runtime.
- **Plaza & path:** concrete plaza, cobblestone path from spawn, four lanterns with warm lights.
- **Landmarks:** RegisterDesk `(14, 2.8, 26)`, AssistantNPC statue `(-16, 1.6, 26)`, LibraryWall bookshelf `(16, 4.75, 44)`, glass pond `(42, 30)`, 9 trees, 2 benches, horizon hills, floating light motes (ParticleEmitter) above the altar.
- **Lighting:** ClockTime 15.4, Atmosphere (density 0.32, haze) for a calm look.

---

## 5. Technical notes

- **Structure:** `VerseData` (ReplicatedStorage ModuleScript) ← required by both `LectioServer` (ServerScriptService Script) and `LectioClient` (StarterPlayerScripts LocalScript). All six RemoteEvents (`LectioExplore`, `LectioRegister`, `LectioAssistant`, `LectioState`, `LectioToday`, `LectioLibrary`) are created by the server at runtime; the client `WaitForChild`s them.

### 5.1 Backend connection (live mode)

The world is wired to this repository's Lectio backend (the site itself). The
game server calls the site API over HTTPS with `HttpService`; readers are keyed
`rb:<RobloxUserId>` in the same D1 tables the website uses
(`usage_daily`, `welcome_credits`, `chat_usage_daily`, plus a small
`roblox_players` registry). Features served live:

| World feature | Backend endpoint | What it uses |
|---|---|---|
| State / usage counters | `POST /api/roblox/state` | daily quota 3/day anon → 6/day registered |
| Explore (1 / 3 / 10 verses) | `POST /api/roblox/explore` | the real 151-verse deck, `generateInterpretation` AI reflection per verse + summary, welcome credits for Divina/Deep |
| Register free | `POST /api/roblox/register` | grants 6/day + 3× Divina + 1× Deep credits (idempotent) |
| Today's reading | `POST /api/roblox/today` | the BCP Daily Office lectionary, focus passage resolved verse-by-verse in WEB + 和合本 |
| Lectio Assistant | `POST /api/roblox/assistant` | the site's AI assistant (same prompt/grounding/quota), non-streaming, aware of the on-screen reading |
| Verse Library | `POST /api/roblox/library` | the whole 151-verse deck in canonical book order |

All requests carry the shared secret in the `X-Lectio-Key` header; the backend
compares it against the `ROBLOX_API_KEY` secret (constant-time). Unset key on
the server → `503 not_configured`; wrong key → `401`.

**Setup:**

1. Backend: set the `ROBLOX_API_KEY` wrangler secret (`npx wrangler secret put ROBLOX_API_KEY`), same value locally in `.env` / `.dev.vars`.
2. Game: on the `LectioServer` Script set the `LectioApiKey` attribute privately in Studio and optionally `LectioBackendUrl` (defaults to `https://enjoyhim.org`). The generator embeds the attribute only with `--embed-api-key`; use a separate untracked output. Never put the real secret in a source constant or tracked place.
3. Studio: enable *Game Settings → Security → Allow HTTP Requests*; a published game has HTTP enabled by default.

**Fallback:** if the key is missing or HTTP is disabled before a draw, the server logs a warning and serves readings from the built-in
`VerseData` (43 verses, DataStore quotas, keyword-rule assistant). A 401/503
switches live mode off for the session instead of hammering a misconfigured
backend. A charged live explore request with an uncertain transport result never triggers a second offline draw. That player's draw stays blocked for the server session rather than risking another charge. A late confirmed client result is retained for explicit resume. AI reflections (`interp`/`summary`) are empty offline.

- **Persistence:** `DataStoreService:GetDataStore("LectioData_v1")`, key `u_<UserId>`, value `{date, daily, registered, divina, deep, assist}` — offline fallback only. All DataStore calls are `pcall`-wrapped with an in-memory fallback, so the place never errors in Studio with API access disabled.
- **Verse selection:** live mode draws randomly from the full deck (exactly like the website — the topic feeds the AI reflection, not the draw). Offline fallback keeps the local keyword→category matching.
- **Erroring:** backend answers `{ok=false, errorKey=...}` over HTTP 200; the client localizes via its `L` table and shows a toast (`limitMsg`, `divinaMsg`, `deepMsg`, `assistantLimitMsg`, `backendError`).
- All three Lua sources pass `luaparse` syntax checking; regenerate with `python generate_lectio.py`.

## 6. How to test

1. Open the generated `Lectio.rbxlx` in Roblox Studio, preserving any other unsaved place.
2. Press **Play (F5)**.
3. Spawn is beside the visible labeled Bible. Choose a ribbon, then click/tap the cover or use the touch prompt. Test page flights, complete text segments, narration, replay, previous/next, and finish. Reading options (Q/controller Y/touch prompt) opens optional intention, calendar, registration, library, assistant, and settings.
4. Start two players and verify that their content and audio stay private. The public board must not display either player's name or verse. Walk away/resume and respawn mid-reading without another draw.
5. Server output shows `Lectio server ready`; client output `Lectio client ready`.

Automated checks from repository root:

```powershell
python -m pip install -r src/roblox/tests/requirements.txt
python -m unittest discover -s src/roblox/tests -p "test_*.py"
npm test -- src/lib/__tests__/roblox-api.test.ts
```

The client/server harnesses execute actual routing and session code with engine doubles. They do not simulate rendering, physics, audio output, or Roblox input devices.

## 7. Known limitations / next steps

- **HTTP + API key required for live mode**: without *Allow HTTP Requests* (Studio) or a matching `LectioApiKey`/`ROBLOX_API_KEY` pair, the world runs in offline fallback (43 local verses, DataStore quotas, keyword assistant) — see §5.1.
- **DataStore persistence** in Studio requires *Game Settings → Security → Enable Studio Access to API Services*; without it, offline-fallback limits/registration are per-session only (by design, no errors).
- **Music asset ID is a placeholder** (`rbxassetid://1841647093`) and may be silent or need replacing with a licensed track.
- **"Registration"** is a backend-recorded free account keyed to the Roblox identity — the same registered-free perks (6/day, trial credits) without the site's email/Google login, which has no Roblox equivalent.
- **Assistant reflection language**: the AI reflection is generated in the language the reading was requested in; toggling language mid-reading re-renders verses but keeps the reflection as generated.
- Bookmarks last only for the current server session. Disconnecting does not preserve reading history.
- Speech uses `AudioTextToSpeech` through a local `AudioDeviceOutput`; actual target-experience permissions, Mandarin output, and rate limits need Studio verification. A failed load leaves readable text with an audio-unavailable indication.
- The reading bubble is intentionally offset to the right of the floating page, compact, bounded by distance, and not always-on-top so the avatar, Bible, and page flight remain visible. Verify this framing in Studio at desktop and mobile aspect ratios.
- R6 fallback gesture and R15 IK need visual verification with varied avatar sizes. Camera framing is brief; reduced motion skips it.
- Reused request IDs cannot redraw after result-cache eviction. Up to 256 request identities are retained per player/session; 16 completed payloads are cached.
- Deferred: persistent history, DataStore migrations, and redesign of secondary menus.

## 8. Source-of-truth references

- Site inspected live: `https://enjoyhim.org/` (Lectio — Daily Scripture Reading and Reflection); `/continuecontinue` is 404.
- Scripture text: KJV (English) and Chinese Union Version (中文), both public domain.
