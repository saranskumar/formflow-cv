"""One-Euro low-pass filter for jittery signals.

Reference: Casiez, Roussel, Vogel (2012)
"""

from __future__ import annotations

import math


class _LowPassFilter:
    def __init__(self) -> None:
        self._x: float | None = None
        self._dx: float = 0.0

    def filter(self, x: float, alpha: float) -> float:
        if self._x is None:
            self._x = x
        result = alpha * x + (1.0 - alpha) * self._x
        self._dx = x - self._x
        self._x = result
        return result

    @property
    def dx(self) -> float:
        return self._dx


class OneEuroFilter:
    """Smooth a 1-D signal adaptively (low frequency = smoother, fast = responsive)."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007, d_cutoff: float = 1.0) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x_filter = _LowPassFilter()
        self._dx_filter = _LowPassFilter()
        self._last_t: float | None = None

    def __call__(self, x: float, t: float) -> float:
        if self._last_t is None:
            self._last_t = t
            return x

        dt = max(t - self._last_t, 1e-6)
        self._last_t = t

        # Derivative filter
        dx = (x - (self._x_filter._x or x)) / dt
        edx = self._dx_filter.filter(dx, self._alpha(self.d_cutoff, dt))

        # Adaptive cutoff
        cutoff = self.min_cutoff + self.beta * abs(edx)
        return self._x_filter.filter(x, self._alpha(cutoff, dt))

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)


class OneEuroFilter2D:
    """One-Euro filter for 2-D (x, y) point."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007, d_cutoff: float = 1.0) -> None:
        self._fx = OneEuroFilter(min_cutoff, beta, d_cutoff)
        self._fy = OneEuroFilter(min_cutoff, beta, d_cutoff)

    def __call__(self, x: float, y: float, t: float) -> tuple[float, float]:
        return self._fx(x, t), self._fy(y, t)

    def reset(self) -> None:
        self._fx = OneEuroFilter(self._fx.min_cutoff, self._fx.beta, self._fx.d_cutoff)
        self._fy = OneEuroFilter(self._fy.min_cutoff, self._fy.beta, self._fy.d_cutoff)
