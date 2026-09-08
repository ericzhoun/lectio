import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from lupa import LuaRuntime

ROOT = Path(__file__).resolve().parents[1]

class NativeTests(unittest.TestCase):
    def test_session_and_requests(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        for name in ('ReadingSession', 'DrawRequests', 'TextSegments', 'Narration'):
            path = ROOT / 'modules' / (name + '.lua')
            self.assertTrue(path.exists(), name + ' must exist')
            lua.globals()[name] = lua.execute(path.read_text(encoding='utf-8'))
        lua.execute((ROOT / 'tests' / 'run.lua').read_text(encoding='utf-8'))

    def test_generator(self):
        spec = importlib.util.spec_from_file_location('generator', ROOT / 'generate_lectio.py')
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        self.assertTrue(hasattr(generator, 'build_document'), 'pure safe build entry point required')
        with patch.object(generator, 'load_api_key', return_value='never-embed-this') as key:
            xml = generator.build_document()
            key.assert_not_called()
        tree = ET.fromstring(xml)
        self.assertFalse(tree.findall('.//BinaryString[@name="AttributesSerialize"]'))
        names = {e.text for e in tree.findall('.//string[@name="Name"]')}
        self.assertTrue({'BibleVisual','Contact','PageDestination','RibbonDaily',
                         'RibbonDivina','RibbonDeep','ReadingSession','DrawRequests'} <= names)
        self.assertNotIn('NativeTests', names)
        self.assertIsNotNone(tree.find('.//float[@name="Gravity"]'))
        with patch.object(generator, 'load_api_key', return_value='private-test-key'):
            private = ET.fromstring(generator.build_document(embed_key=True))
        self.assertEqual(private.findtext('.//bool[@name="HttpEnabled"]'), 'true',
                         'explicit private live builds must enable backend HTTP')

    def test_generated_place_matches_sources_and_has_unique_references(self):
        spec = importlib.util.spec_from_file_location('generator', ROOT / 'generate_lectio.py')
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        actual = (ROOT / 'Lectio.rbxlx').read_text(encoding='utf-8')
        self.assertEqual(actual, generator.build_document())
        root = ET.fromstring(actual)
        refs = [e.attrib['referent'] for e in root.findall('.//Item')]
        self.assertEqual(len(refs), len(set(refs)))
        self.assertFalse(root.findall('.//BinaryString[@name="AttributesSerialize"]'))

    def test_arrival_has_visible_identifiable_bible_within_walking_reach(self):
        spec = importlib.util.spec_from_file_location('generator', ROOT / 'generate_lectio.py')
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        root = ET.fromstring(generator.build_document())
        items = {i.findtext('Properties/string[@name="Name"]'): i for i in root.findall('.//Item')}
        def position(item):
            frame = item.find('Properties/CoordinateFrame[@name="CFrame"]')
            return tuple(float(frame.findtext(axis)) for axis in ('X','Y','Z'))
        spawn, bible = position(items['SpawnLocation']), position(items['AltarBible'])
        self.assertLess(sum((a-b)**2 for a,b in zip(spawn,bible))**0.5, 8,
                        'Bible must be in the arrival view, not across the whole garden')
        model = items['BibleVisual']
        titles = [n.text for n in model.findall('.//string[@name="Text"]')]
        self.assertTrue(any('BIBLE' in (t or '') for t in titles), 'visible cover title identifies the Bible')
        for name in ('CoverLeft','CoverRight','PageBlock','BackCover','Spine'):
            self.assertLess(float(items[name].findtext('Properties/float[@name="Transparency"]')),1)

    def test_all_lua_compiles(self):
        lua = LuaRuntime()
        compile_lua = lua.eval('function(source, name) local f,e=load(source,name); return f ~= nil,e end')
        for path in ROOT.rglob('*.lua'):
            ok, error = compile_lua(path.read_text(encoding='utf-8'), str(path))
            self.assertTrue(ok, error)

    def server(self, live=False, fail=False):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.globals().VerseData = lua.execute((ROOT / 'src_verse_data.lua').read_text(encoding='utf-8'))
        lua.globals().DrawRequests = lua.execute((ROOT / 'modules/DrawRequests.lua').read_text(encoding='utf-8'))
        lua.globals().liveMode = live
        lua.globals().failHttp = fail
        lua.execute((ROOT / 'tests/server_harness.lua').read_text(encoding='utf-8'))
        lua.execute((ROOT / 'src_server.lua').read_text(encoding='utf-8'))
        return lua

    def test_live_timeout_never_draws_offline(self):
        lua = self.server(live=True, fail=True)
        lua.execute('''
            local p=newPlayer(1)
            local event=getRemote("LectioExplore").OnServerEvent.callback
            event(p,"peace","daily","en","request-1")
            assert(p.last.status=="uncertain")
            event(p,"peace","daily","en","request-2")
            assert(httpCalls==1 and dataWrites==0)
            assertPrivateBoard()
        ''')

    def test_offline_replay_keeps_quota_and_private_board(self):
        lua = self.server()
        lua.execute('''
            local p=newPlayer(1)
            local event=getRemote("LectioExplore").OnServerEvent.callback
            event(p,"peace","daily","en","request-1")
            assert(p.last.status=="complete" and p.last.response.state.used==1)
            event(p,"peace","daily","en","request-1")
            assert(p.last.response.state.used==1 and dataWrites==1)
            distance=20
            event(p,"peace","daily","en","request-2")
            assert(p.last.status=="rejected" and dataWrites==1)
            assertPrivateBoard()
        ''')

    def test_live_success_replays_without_another_backend_call(self):
        lua = self.server(live=True)
        lua.execute('''
            backendResponse={ok=true,verses={{textEn="PRIVATE_VERSE"}},mode="daily"}
            local p=newPlayer(1)
            local event=getRemote("LectioExplore").OnServerEvent.callback
            event(p,"private question","daily","en","request-1")
            event(p,"private question","daily","en","request-1")
            assert(p.last.status=="complete" and httpCalls==1)
            assertPrivateBoard()
        ''')

    def test_client_flow_never_redraws_on_resume_or_replay(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        for name in ('ReadingSession','Narration'):
            lua.globals()[name] = lua.execute((ROOT / 'modules' / (name+'.lua')).read_text(encoding='utf-8'))
        lua.execute((ROOT / 'tests/client_harness.lua').read_text(encoding='utf-8'))
        lua.globals().Native = lua.execute((ROOT / 'modules/NativeReading.lua').read_text(encoding='utf-8'))
        lua.execute('''
            local n=Native.new(remotes,options)
            n:activate()
            assert(calls==0 and lastToast=="approachBible")
            interactionAction({type="near",value=true})
            n:activate(); n:activate()
            assert(calls==1)
            interactionAction({type="near",value=false})
            n:receive({requestId=requestId,status="complete",response={ok=true,mode="daily",
                verses={{en="one",zh="一"},{textEn="two",textZh="二"}}}},false)
            shortTimers()
            assert(n.session.phase=="paused" and speechStarts()==0)
            interactionAction({type="near",value=true})
            assert(n.session.phase=="paused")
            n:activate()
            n:action({type="next"})
            n:action({type="replay"})
            assert(calls==1 and n.session.page==2 and speechStarts()==3)
            options.labels=function() return {"读经","回应"} end
            n:setLanguage("zh")
            assert(n.session.reading.labels[2]=="回应")
            n:action({type="finish"}); shortTimers(); timeoutTimers()
            assert(n.session.phase=="idle" and accepted==nil and calls==1)
            n:activate()
            n:receive({requestId=requestId,status="rejected",response={ok=false,errorKey="limitMsg"}},false)
            timeoutTimers()
            assert(n.session.phase=="failed" and lastToast=="limitMsg")
        ''')

    def test_reflection_summary_content_is_visible_and_never_blank(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        path = ROOT / 'modules/ReadingText.lua'
        self.assertTrue(path.exists(), 'reading sections must preserve live content and fill empty display states')
        lua.globals().ReadingText = lua.execute(path.read_text(encoding='utf-8'))
        lua.execute('''
            local reading={verses={{refEn="Psalm 46:10",textEn="Be still",interp="A quiet invitation"},
                {refEn="John 14:27",textEn="Peace",interp="Receive peace"}},summary="Rest in peace"}
            local view=ReadingText.build(reading,1,"en","Be still","scripture")
            assert(view.body:find("A quiet invitation",1,true))
            view=ReadingText.build(reading,2,"en","Peace","scripture")
            assert(view.body:find("Receive peace",1,true) and view.body:find("Rest in peace",1,true))
            view=ReadingText.build(reading,1,"en","Be still","summary")
            assert(view.body=="Rest in peace")
            local offline={verses={{refZh="诗篇 46:10",textZh="你们要休息",interp="  "}},summary=""}
            view=ReadingText.build(offline,1,"zh","你们要休息","reflection")
            assert(#view.body>0 and view.heading=="默想提示")
            view=ReadingText.build(offline,1,"zh","你们要休息","summary")
            assert(view.heading=="阅读回顾" and view.body:find("诗篇 46:10",1,true))
        ''')

    def test_reading_bubble_keeps_center_view_clear(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        path = ROOT / 'modules/ReadingLayout.lua'
        self.assertTrue(path.exists(), 'reading bubble layout must be explicit')
        lua.globals().ReadingLayout = lua.execute(path.read_text(encoding='utf-8'))
        lua.execute('''
            local layout=ReadingLayout.place(1280,720,{{x=420,y=120,width=380,height=500}})
            assert(layout.visible and not layout.collapsed and layout.bodyHeight>=96)
            assert(layout.x>=800 or layout.x+layout.width<=420)
        ''')

if __name__ == '__main__':
    unittest.main()
