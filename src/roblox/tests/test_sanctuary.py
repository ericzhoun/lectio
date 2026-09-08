"""User-visible sanctuary behavior, exercised without Roblox services."""

from pathlib import Path
import unittest

from lupa import LuaRuntime


ROOT = Path(__file__).resolve().parents[1]


class SanctuaryTests(unittest.TestCase):
    def presentation(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute((ROOT / "tests/presentation_harness.lua").read_text(encoding="utf-8"))
        for name in ("TextSegments", "ReadingText", "ReadingLayout", "ReadingPractice", "ReadingTheme"):
            lua.globals().script["Parent"][name] = lua.execute(
                (ROOT / "modules" / (name + ".lua")).read_text(encoding="utf-8")
            )
        lua.globals().Presentation = lua.execute(
            (ROOT / "modules/BiblePresentation.lua").read_text(encoding="utf-8")
        )
        return lua

    def module(self, name):
        lua = LuaRuntime(unpack_returned_tuples=True)
        path = ROOT / "modules" / (name + ".lua")
        self.assertTrue(path.exists(), name + " must exist")
        return lua, lua.execute(path.read_text(encoding="utf-8"))

    def assert_placement(self, placement, width, height, protected):
        self.assertTrue(placement["visible"], "there is space for at least the reading handle")
        x, y = placement["x"], placement["y"]
        panel_width, panel_height = placement["width"], placement["height"]
        self.assertGreater(panel_width, 0)
        self.assertGreaterEqual(x, 12)
        self.assertGreaterEqual(y, 48)
        self.assertLessEqual(x + panel_width, width - 12)
        self.assertLessEqual(y + panel_height, height - 12)
        for rect in protected:
            overlaps = (
                x < rect["x"] + rect["width"]
                and x + panel_width > rect["x"]
                and y < rect["y"] + rect["height"]
                and y + panel_height > rect["y"]
            )
            self.assertFalse(overlaps, "reading controls must leave avatar and Bible visible")
        if placement["collapsed"]:
            self.assertEqual(panel_height, 48)
        else:
            self.assertGreaterEqual(placement["bodyHeight"], 96, "scripture needs a readable area")

    def place(self, lua, layout, width, height, protected, previous_edge=None):
        self.assertIsNotNone(layout["place"], "layout must use projected avatar/Bible bounds")
        return layout["place"](
            width,
            height,
            lua.table_from([lua.table_from(rect) for rect in protected]),
            previous_edge,
        )

    def test_reading_fits_devices_without_covering_avatar_or_bible(self):
        lua, layout = self.module("ReadingLayout")
        cases = (
            (390, 844, [{"x": 55, "y": 170, "width": 280, "height": 390}]),
            (1280, 720, [{"x": 430, "y": 170, "width": 430, "height": 460}]),
            (844, 390, [{"x": 300, "y": 72, "width": 245, "height": 296}]),
            (320, 568, [{"x": 75, "y": 100, "width": 170, "height": 320}]),
        )
        for width, height, protected in cases:
            with self.subTest(viewport=(width, height)):
                placement = self.place(lua, layout, width, height, protected)
                self.assert_placement(placement, width, height, protected)
                if width == 1280:
                    self.assertFalse(placement["collapsed"], "desktop has room for the full reader")

    def test_camera_orbit_keeps_reader_clear_of_projected_scene(self):
        lua, layout = self.module("ReadingLayout")
        previous_edge = None
        for scene_x in (330, 470, 670, 830, 670, 470, 330):
            protected = [
                {"x": scene_x, "y": 155, "width": 210, "height": 425},
                {"x": scene_x - 40, "y": 330, "width": 200, "height": 160},
            ]
            with self.subTest(scene_x=scene_x):
                placement = self.place(lua, layout, 1280, 720, protected, previous_edge)
                self.assert_placement(placement, 1280, 720, protected)
                self.assertFalse(placement["collapsed"])
                self.assertIsNotNone(placement["edge"])
                previous_edge = placement["edge"]

    def test_tight_space_collapses_reader_to_handle(self):
        lua, layout = self.module("ReadingLayout")
        protected = [{"x": 12, "y": 48, "width": 776, "height": 340}]
        placement = self.place(lua, layout, 800, 460, protected)
        self.assert_placement(placement, 800, 460, protected)
        self.assertTrue(placement["collapsed"], "60px gap cannot fit readable scripture")
        self.assertEqual(placement["height"], 48)

    def test_no_safe_space_hides_even_the_handle(self):
        lua, layout = self.module("ReadingLayout")
        placement = self.place(
            lua, layout, 800, 460,
            [{"x": 12, "y": 48, "width": 776, "height": 400}],
        )
        self.assertFalse(placement["visible"], "never cover the scene to force a control into view")

    def test_six_practices_are_bilingual_and_only_scripture_is_narrated(self):
        _, practice = self.module("ReadingPractice")
        expected = ("silencio", "lectio", "meditatio", "oratio", "contemplatio", "actio")
        self.assertEqual(tuple(practice["order"].values()), expected)
        for index, key in enumerate(expected):
            if index + 1 < len(expected):
                self.assertEqual(practice["next"](key), expected[index + 1])
            for language in ("en", "zh"):
                with self.subTest(practice=key, language=language):
                    step = practice["get"](key, language)
                    self.assertTrue(step["title"].strip())
                    self.assertTrue(step["prompt"].strip())
                    self.assertEqual(step["narrate"], key == "lectio")
                    self.assertTrue(step["view"])
                    if key == "meditatio":
                        self.assertEqual(step["view"], "reflection")
                    if key == "actio":
                        self.assertEqual(step["view"], "summary")
            self.assertNotEqual(practice["get"](key, "en")["title"],
                                practice["get"](key, "zh")["title"])

    def test_first_touch_uses_today_and_browsing_never_requests_another_reading(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        for name in ("ReadingSession", "Narration"):
            lua.globals()[name] = lua.execute(
                (ROOT / "modules" / (name + ".lua")).read_text(encoding="utf-8")
            )
        lua.execute((ROOT / "tests/client_harness.lua").read_text(encoding="utf-8"))
        practice_path = ROOT / "modules/ReadingPractice.lua"
        if practice_path.exists():
            lua.globals().script["Parent"]["ReadingPractice"] = lua.execute(
                practice_path.read_text(encoding="utf-8")
            )
        lua.execute('''
            remotes.LectioExplore.FireServer=function(_,topic,mode,lang,id)
                calls=calls+1; requestId=id; lastRemote="explore"
            end
            remotes.LectioToday.FireServer=function(_,lang,id)
                calls=calls+1; requestId=id; lastRemote="today"
            end
        ''')
        lua.globals().Native = lua.execute(
            (ROOT / "modules/NativeReading.lua").read_text(encoding="utf-8")
        )
        lua.execute('''
            local reading=Native.new(remotes,options)
            interactionAction({type="near",value=true})
            reading:activate(); reading:activate()
            assert(calls==1, "repeated contact must share one request")
            assert(lastRemote=="today", "first contact should open today's free reading")
            reading:receive({requestId=requestId,status="complete",response={ok=true,
                titleEn="Today's reading",titleZh="今日读经",
                steps={{refEn="Psalm 46:10",en="Be still",zh="你们要休息"},
                       {refEn="John 14:27",en="Peace",zh="平安"}}}},true)
            shortTimers()
            reading:action({type="next"})
            reading:action({type="replay"})
            reading:action({type="previous"})
            reading:action({type="replay"})
            assert(calls==1, "page navigation and replay must reuse the accepted reading")
            assert(reading.session.reading and #reading.session.reading.verses==2)
        ''')

    def test_bubble_waits_for_page_flight_and_builds_readable_content(self):
        lua = self.presentation()
        lua.execute('''
            local p=newPresentation()
            showReading(p,exampleReading())
            assert(#p.pages==1, "a physical page must fly before its reader appears")
            assert(countBubbles()==0 and p.gui==nil)
            advance(0.64)
            assert(countBubbles()==0, "reading UI must not cover the page flight")
            advance(0.02)
            assert(countBubbles()==1 and p.gui.ClassName=="ScreenGui")
            assert(p.gui.Enabled and p.card.Visible and not p.handle.Visible)
            assert(p.scroll.Size.Y.Offset>=96)
            assert(p.body.Text:find("Be still, and know that I am God.",1,true))
            assert(p.body.Text:find("Receive the supplied reflection.",1,true))
        ''')

    def test_dismissal_during_page_flight_cannot_revive_bubble(self):
        for dismissal in ("clear", "paused", "closing"):
            with self.subTest(dismissal=dismissal):
                lua = self.presentation()
                lua.globals().dismissal = dismissal
                lua.execute('''
                    local p=newPresentation()
                    local reading=exampleReading()
                    showReading(p,reading)
                    advance(0.2)
                    if dismissal=="clear" then p:clear()
                    else showReading(p,reading,1,"en",dismissal) end
                    advance(1)
                    renderFrame()
                    assert(countBubbles()==0, "dismissed reading timer must stay dismissed")
                ''')

    def test_page_switch_invalidates_old_bubble_timer(self):
        lua = self.presentation()
        lua.execute('''
            local p=newPresentation()
            local reading=exampleReading()
            showReading(p,reading,1)
            advance(0.3)
            showReading(p,reading,2)
            advance(0.36)
            assert(countBubbles()==0, "first page timer must not reveal the second page early")
            advance(0.3)
            assert(countBubbles()==1 and p.bubblePage==p.pages[2])
            assert(p.ref.Text:find("John 14:27",1,true))
            assert(p.body.Text:find("Peace I leave with you.",1,true))
        ''')

    def test_close_hides_existing_reader_and_disconnects_layout_updates(self):
        lua = self.presentation()
        lua.execute('''
            local p=newPresentation()
            local reading=exampleReading()
            showReading(p,reading)
            advance(0.7)
            local gui=p.gui
            assert(gui.Enabled)
            showReading(p,reading,1,"en","closing")
            assert(not gui.Enabled)
            renderFrame(); advance(1)
            assert(not gui.Enabled, "camera updates must not reopen the closing reader")
        ''')

    def test_movements_pause_voice_keep_content_and_collapse_for_rest(self):
        lua = self.presentation()
        lua.execute('''
            local p=newPresentation()
            local reading=exampleReading()
            showReading(p,reading)
            advance(0.7)
            p:selectMovement("meditatio")
            assert(p.body.Text=="Receive the supplied reflection.")
            assert(not p:allowsNarration())
            p:selectMovement("oratio")
            assert(p.body.Text:find("Respond quietly",1,true))
            p:selectMovement("contemplatio")
            assert(not p.card.Visible and p.handle.Visible and p.handle.Size.Y.Offset==48)
            assert(p.handle.Text:find("Rest a while",1,true))
            p:selectMovement("actio")
            assert(p.card.Visible and not p.handle.Visible)
            assert(p.body.Text:find(reading.summary,1,true), "supplied summary must survive the practice prompt")
            assert(#actions==4)
            for _,action in ipairs(actions) do assert(action=="pause", "quiet practices must not draw or narrate") end
        ''')

    def test_flying_pages_receive_bilingual_scripture_on_both_faces(self):
        lua = self.presentation()
        lua.execute('''
            local p=newPresentation()
            local reading=exampleReading()
            showReading(p,reading,1,"en")
            local faces=0
            for _,surface in ipairs(p.pages[1]:GetChildren()) do
                if surface:IsA("SurfaceGui") then
                    faces=faces+1
                    assert(surface.Scripture.Text=="Psalm 46:10\\n\\nBe still, and know that I am God.")
                    assert(surface.Enabled)
                end
            end
            assert(faces==2, "flying pages need lettering on both visible faces")
            advance(0.3)
            showReading(p,reading,1,"zh")
            advance(0.36)
            assert(countBubbles()==0, "previous-language timer must not reveal stale text")
            advance(0.3)
            for _,surface in ipairs(p.pages[1]:GetChildren()) do
                if surface:IsA("SurfaceGui") then
                    assert(surface.Scripture.Text=="诗篇 46:10\\n\\n你们要休息，要知道我是神。")
                end
            end
            assert(p.body.Text:find("你们要休息，要知道我是神。",1,true))
            assert(p.ref.Text:find("诗篇 46:10",1,true))
        ''')

    def test_compact_reader_keeps_full_text_and_sections_available(self):
        lua = self.presentation()
        lua.execute('''
            workspace.CurrentCamera.ViewportSize=Vector2.new(390,844)
            local p=newPresentation()
            p.protectedRects=function() return {{x=55,y=170,width=280,height=390}} end
            local reading=exampleReading()
            reading.verses[1].textEn=string.rep("A complete passage. ",30).."THE END"
            showReading(p,reading)
            advance(0.7)
            assert(p.compact and p.card.Visible and not p.handle.Visible)
            assert(p.scroll.Size.Y.Offset>=96)
            assert(p.body.Text:find("THE END",1,true), "compact view must not lose later scripture segments")
            assert(p.tabs[1].button.Visible and p.tabs[2].button.Visible and p.tabs[3].button.Visible)
            p.tabs[2].button.Activated:Fire()
            assert(p.body.Text==reading.verses[1].interp)
            p.tabs[3].button.Activated:Fire()
            assert(p.body.Text:find(reading.summary,1,true))
        ''')

    def test_stopped_voice_can_restart_and_resume_closes_options(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        for name in ("ReadingSession", "Narration"):
            lua.globals()[name] = lua.execute((ROOT / "modules" / (name + ".lua")).read_text(encoding="utf-8"))
        lua.execute((ROOT / "tests/client_harness.lua").read_text(encoding="utf-8"))
        lua.globals().Native = lua.execute((ROOT / "modules/NativeReading.lua").read_text(encoding="utf-8"))
        lua.execute('''
            local opened=true
            options.begin=function() opened=false end
            local n=Native.new(remotes,options)
            interactionAction({type="near",value=true}); n:activate("daily")
            assert(not opened)
            n:receive({requestId=requestId,status="complete",response={ok=true,mode="daily",
                verses={{textEn="Peace",textZh="平安"}}}},false)
            shortTimers()
            local status
            n.narrator.onState=function(value) status=value end
            n:setLanguage("zh")
            assert(status=="idle" and not n.narrator.playback)
            local starts=speechStarts()
            n:action({type="resume"})
            assert(speechStarts()==starts+1, "listen after language change must restart stopped speech")
            interactionAction({type="near",value=false})
            opened=true
            interactionAction({type="near",value=true}); n:activate()
            assert(not opened and calls==1, "resume must dismiss options without another reading")
        ''')


if __name__ == "__main__":
    unittest.main()
