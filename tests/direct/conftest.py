"""Direct-mode gltest fixtures for the ProofMile Escrow test suite."""
import sys
from pathlib import Path

# Make the tests directory importable so helpers.py can be imported from
# anywhere pytest is launched.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
