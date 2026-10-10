"""FormFlow launcher script."""

import sys
from pathlib import Path

# Add src to sys.path so it works out-of-the-box
src_dir = Path(__file__).parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from formflow.app import main

if __name__ == "__main__":
    main()
