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

    def test_all_lua_compiles(self):
        lua = LuaRuntime()
        compile_lua = lua.eval('function(source, name) local f,e=load(source,name); return f ~= nil,e end')
        for path in ROOT.rglob('*.lua'):
            ok, error = compile_lua(path.read_text(encoding='utf-8'), str(path))
            self.assertTrue(ok, error)

if __name__ == '__main__':
    unittest.main()
