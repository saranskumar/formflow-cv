"""Turn the SVG sources in samples/svg/ into the PNG pictures the app loads (samples/<set>/<view>.png).

    python samples/svg_to_png.py            # uses Chrome or Edge in headless mode, so nothing extra to install

The SVGs are the editable originals: change one (or make_svgs.py), run this again, and the demo picture follows.
"""
import glob
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BROWSERS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]


def main():
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        sys.exit('Chrome or Edge was not found; install one, or convert the SVGs in samples/svg with any tool.')
    svgs = sorted(glob.glob(os.path.join(HERE, 'svg', '*', '*.svg')))
    with tempfile.TemporaryDirectory() as profile:
        for svg in svgs:
            name, view = os.path.basename(os.path.dirname(svg)), os.path.splitext(os.path.basename(svg))[0]
            out = os.path.join(HERE, name, f'{view}.png')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            subprocess.run([browser, '--headless=new', '--disable-gpu', f'--user-data-dir={profile}', '--hide-scrollbars',
                            '--default-background-color=ffffffff', '--window-size=720,540', f'--screenshot={out}', 'file:///' + svg.replace(os.sep, '/')],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            print('wrote', os.path.relpath(out, HERE))


if __name__ == '__main__':
    main()
