# PyInstaller spec for the local Python engine. The Electron shell supplies
# --project-root at runtime, so product config and yt-dlp remain external and
# can be updated without rebuilding the Python executable.
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

project = Path(SPECPATH).parent
python_root = project / "python"

hiddenimports = collect_submodules("cryptography")

a = Analysis(
    [str(python_root / "easy_download_sidecar.py")],
    pathex=[str(python_root)],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="easy_download_sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
