"""Tests for One-Euro filter."""

import math
import time

from formflow.hands.filters import OneEuroFilter, OneEuroFilter2D


def test_one_euro_converges_to_constant():
    f = OneEuroFilter(min_cutoff=1.0, beta=0.007)
    t = 0.0
    val = 0.0
    for _ in range(200):
        val = f(50.0, t)
        t += 1.0 / 30.0
    assert abs(val - 50.0) < 1.0


def test_one_euro_2d_converges():
    f = OneEuroFilter2D()
    t = 0.0
    for _ in range(200):
        x, y = f(100.0, 200.0, t)
        t += 1.0 / 30.0
    assert abs(x - 100.0) < 2.0
    assert abs(y - 200.0) < 2.0


def test_one_euro_reduces_jitter():
    import random
    f = OneEuroFilter(min_cutoff=1.0, beta=0.007)
    rng = random.Random(42)
    t = 0.0
    raw = []
    filtered = []
    for _ in range(100):
        x = 50.0 + rng.uniform(-10, 10)
        raw.append(x)
        filtered.append(f(x, t))
        t += 1.0 / 30.0

    raw_std = (sum((v - sum(raw) / len(raw)) ** 2 for v in raw) / len(raw)) ** 0.5
    fil_std = (sum((v - sum(filtered) / len(filtered)) ** 2 for v in filtered) / len(filtered)) ** 0.5
    assert fil_std < raw_std
