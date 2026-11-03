from __future__ import annotations

import sqlite3

import pytest

from app.db import read_tx, write_tx


def test_nested_write_tx_rejected(tmp_path):
    from app.db import connect, initialize

    conn = connect(tmp_path / "t.db")
    initialize(conn)
    with write_tx(conn):
        with pytest.raises(RuntimeError):
            with write_tx(conn):
                pass
    assert conn.in_transaction is False
    conn.close()


def test_read_tx_rolls_back_on_error(tmp_path):
    from app.db import connect, initialize

    conn = connect(tmp_path / "t.db")
    initialize(conn)
    with pytest.raises(ValueError):
        with read_tx(conn):
            conn.execute("SELECT COUNT(*) FROM students").fetchone()
            raise ValueError("boom")
    assert conn.in_transaction is False
    conn.close()
