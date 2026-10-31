"""Release gate: inspect the frozen code actually executed, not adjacent .py files."""
from pathlib import Path
import types
from PyInstaller.archive.readers import CArchiveReader

root = Path(__file__).resolve().parents[1]
archive = CArchiveReader(str(root / 'runtime' / 'easy_download_sidecar.exe'))
pyz = archive.open_embedded_archive('PYZ.pyz')

def constants(value):
    if isinstance(value, types.CodeType):
        for item in value.co_consts:
            yield from constants(item)
    elif isinstance(value, (tuple, frozenset)):
        for item in value:
            yield from constants(item)
    elif isinstance(value, str):
        yield value

engine = set(constants(pyz.extract('download_engine')))
assert {'--progress', '--concurrent-fragments', '--abort-on-unavailable-fragments'} <= engine, 'Frozen HLS/progress logic is stale'
cookies = pyz.extract('cookie_store')
def code_names(code):
    yield code.co_name
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            yield from code_names(value)
assert 'browser_session_cookies' in set(code_names(cookies)), 'Frozen Chrome session adapter is stale'
print('Frozen engine code gate passed: HLS, progress and scoped browser cookies')
