"""Download the extra MediaPipe models into web/vendor/models/ so every model in the Models panel works offline.

    python tools/download_models.py            # downloads what is missing (about 62 MB)
    python tools/download_models.py --list     # shows what is there

The files are the official ones from Google's model storage (the same addresses the Models panel uses). They are not
committed to git; run this once on each computer. The two models the app always needs ship in web/vendor already.
"""
import argparse
import os
import sys
import urllib.request

GS = "https://storage.googleapis.com/mediapipe-models"
MODELS = {
    "gesture_recognizer.task": f"{GS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
    "holistic_landmarker.task": f"{GS}/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task",
    "pose_landmarker_full.task": f"{GS}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "pose_landmarker_heavy.task": f"{GS}/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
}
DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "vendor", "models")


def fetch(name, url):
    path = os.path.join(DEST, name)
    tmp = path + ".part"
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as out:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = r.read(1 << 18)
            if not chunk:
                break
            out.write(chunk)
            got += len(chunk)
            if total:
                print(f"\r  {name}: {got * 100 // total}% of {total / 1e6:.1f} MB", end="", flush=True)
    if total and got != total:
        os.remove(tmp)
        raise IOError(f"{name}: got {got} of {total} bytes")
    os.replace(tmp, path)
    print(f"\r  {name}: {got / 1e6:.1f} MB, done          ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    os.makedirs(DEST, exist_ok=True)
    missing = []
    for name, url in MODELS.items():
        path = os.path.join(DEST, name)
        have = os.path.getsize(path) if os.path.exists(path) else 0
        print(f"{'have   ' if have else 'missing'} {name}" + (f"  ({have / 1e6:.1f} MB)" if have else ""))
        if not have:
            missing.append((name, url))
    if args.list or not missing:
        return 0
    for name, url in missing:
        try:
            fetch(name, url)
        except Exception as e:  # keep going: one failed download should not stop the others
            print(f"  {name}: FAILED ({e})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
