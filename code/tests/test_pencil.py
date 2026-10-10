"""Tests for pencil state machine."""

from formflow.pencil.state_machine import PencilState, PencilStateMachine


def _make_machine():
    m = PencilStateMachine()
    started = []
    points = []
    ended = []
    m.on_stroke_start(lambda pos: started.append(pos))
    m.on_point(lambda pos: points.append(pos))
    m.on_stroke_end(lambda: ended.append(True))
    return m, started, points, ended


def test_no_hand_stays_no_hand():
    m, *_ = _make_machine()
    assert m.update(False, False, None) == PencilState.NO_HAND
    assert m.update(False, False, None) == PencilState.NO_HAND


def test_hand_no_pinch_is_hover():
    m, *_ = _make_machine()
    assert m.update(True, False, (10, 10)) == PencilState.HOVER


def test_pinch_starts_drawing():
    m, started, points, ended = _make_machine()
    m.update(True, False, (10, 10))   # HOVER
    m.update(True, True, (10, 10))    # DRAWING
    assert len(started) == 1
    assert m.state == PencilState.DRAWING


def test_points_emitted_while_drawing():
    m, started, points, ended = _make_machine()
    m.update(True, True, (0, 0))
    m.update(True, True, (10, 10))
    m.update(True, True, (20, 20))
    assert len(points) == 2   # first call starts, subsequent emit points


def test_release_pinch_ends_stroke():
    m, started, points, ended = _make_machine()
    m.update(True, True, (0, 0))
    m.update(True, True, (10, 10))
    m.update(True, False, (10, 10))  # release
    assert len(ended) == 1
    assert m.state == PencilState.HOVER


def test_hand_loss_mid_stroke_ends_cleanly():
    m, started, points, ended = _make_machine()
    m.update(True, True, (0, 0))
    m.update(True, True, (5, 5))
    m.update(False, False, None)    # hand lost
    assert len(ended) == 1
    assert m.state == PencilState.NO_HAND


def test_return_after_loss_starts_in_hover():
    m, *_ = _make_machine()
    m.update(True, True, (0, 0))
    m.update(False, False, None)
    state = m.update(True, False, (0, 0))
    assert state == PencilState.HOVER
