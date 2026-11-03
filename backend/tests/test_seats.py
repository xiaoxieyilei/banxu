from __future__ import annotations


def test_move_to_empty_and_swap(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    state = client.post("/api/seats/move", json={"studentId": "002", "target": "R1C1"}).json()
    assert state["seats"]["R1C1"] == "002"
    assert "001" not in state["seats"].values()


def test_swap_occupied_seats(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    client.post("/api/seats/move", json={"studentId": "002", "target": "R1C2"})
    state = client.post("/api/seats/move", json={"studentId": "001", "target": "R1C2"}).json()
    assert state["seats"]["R1C1"] == "002"
    assert state["seats"]["R1C2"] == "001"


def test_unseat_student(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    state = client.post("/api/seats/move", json={"studentId": "001", "target": None}).json()
    assert state["seats"] == {}


def test_invalid_seat_rejected(client, seeded):
    response = client.post("/api/seats/move", json={"studentId": "001", "target": "R8C1"})
    assert response.status_code == 400
    assert client.get("/api/state").json()["seats"] == {}


def test_rotate_four_times_returns_to_start(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    client.post("/api/seats/move", json={"studentId": "002", "target": "R1C7"})
    client.post("/api/seats/move", json={"studentId": "003", "target": "X1"})
    original = client.get("/api/state").json()["seats"]
    for _ in range(4):
        client.post("/api/seats/rotate")
    assert client.get("/api/state").json()["seats"] == original


def test_rotate_moves_group_and_keeps_extra_seat(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R7C5"})
    client.post("/api/seats/move", json={"studentId": "002", "target": "X2"})
    state = client.post("/api/seats/rotate").json()
    assert state["seats"]["R7C3"] == "001"
    assert state["seats"]["X2"] == "002"


def test_replace_seats_validates(client, seeded):
    bad = client.put("/api/seats", json={"seats": {"R1C1": "001", "R1C2": "001"}})
    assert bad.status_code == 400
    good = client.put("/api/seats", json={"seats": {"R1C1": "001", "R1C2": "002"}})
    assert good.status_code == 200
    assert good.json()["seats"] == {"R1C1": "001", "R1C2": "002"}


def test_clear_seats(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    assert client.delete("/api/seats").json()["seats"] == {}


def test_shrink_rows_drops_seventh_row_seats(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R7C1"})
    state = client.patch("/api/settings", json={"rows": 6, "extraRow": 5}).json()
    assert state["settings"]["rows"] == 6
    assert "R7C1" not in state["seats"]


def test_reject_invalid_layout(client):
    assert client.patch("/api/settings", json={"rows": 5}).status_code == 400
    assert client.patch("/api/settings", json={"rows": 6, "extraRow": 6}).status_code == 400
