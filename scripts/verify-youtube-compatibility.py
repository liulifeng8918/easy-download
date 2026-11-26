"""Use only this app's previously authorized session; never print credentials."""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--app', required=True, type=Path)
p.add_argument('--engine', required=True, type=Path)
p.add_argument('--download-dir', type=Path)
a = p.parse_args()
app, engine = a.app.resolve(), a.engine.resolve()
if a.download_dir:
    a.download_dir = a.download_dir.resolve()
os.environ['LOCALAPPDATA'] = str(app / 'user-data' / 'local')
sys.path.insert(0, str(app / 'python'))
from cookie_store import CookieStore

cookie, cleanup = CookieStore().temporary_file()
try:
    args = [str(engine), '--ignore-config', '--no-playlist', '--no-cache-dir',
            '--proxy', 'http://127.0.0.1:7892', '--js-runtimes', 'node:' + str(app / 'runtime' / 'node.exe'),
            '--socket-timeout', '20', '--retries', '1', '--extractor-retries', '1']
    if cookie:
        args += ['--cookies', cookie]
    if a.download_dir:
        a.download_dir.mkdir(parents=True, exist_ok=True)
        args += ['-f', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4',
                 '--ffmpeg-location', str(app / 'bin'), '-o', str(a.download_dir / 'youtube-720p.%(ext)s'),
                 '--print', 'after_move:%(filepath)s']
    else:
        args += ['--skip-download', '--dump-single-json']
    args += ['https://www.youtube.com/watch?v=C9v5lIPG44o']
    result = subprocess.run(args, cwd=app, capture_output=True, text=True, encoding='utf-8', errors='replace',
                            timeout=240 if a.download_dir else 60, creationflags=subprocess.CREATE_NO_WINDOW)
    report = {'ok': result.returncode == 0, 'engine': str(engine), 'download': bool(a.download_dir)}
    if not a.download_dir:
        try:
            info = json.loads(result.stdout)
            if not isinstance(info, dict):
                info = {}
            report.update(id=info.get('id'), duration=info.get('duration'),
                          videoHeights=sorted({f['height'] for f in info.get('formats', []) if f.get('height') and f.get('vcodec') not in (None, 'none')}))
        except ValueError:
            pass
    else:
        report['output'] = result.stdout.strip()
    report['warnings'] = [re.sub(r'https?://\S+', '[URL]', s) for s in result.stderr.splitlines()
                          if s.startswith(('ERROR:', 'WARNING:'))]
    print(json.dumps(report, ensure_ascii=True, indent=2))
    if result.returncode:
        sys.exit(1)
finally:
    cleanup()
