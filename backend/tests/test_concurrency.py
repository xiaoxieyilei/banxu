from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor


def test_parallel_discipline_writes_are_serialized(client, seeded):
    def add(index: int) -> int:
        response = client.post(
            "/api/discipline",
            json={
                "studentId": "001",
                "date": "2026-10-%02d" % (index % 28 + 1),
                "type": "迟到违纪",
                "reason": "并发 %d" % index,
            },
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(add, range(20)))

    assert set(codes) == {200}
    state = client.get("/api/state").json()
    assert len(state["discipline"]["001"]) == 20


def test_parallel_seat_moves_keep_consistency(client, seeded):
    students = ["001", "002", "003"]

    def move(index: int) -> int:
        seat = "R%dC%d" % (index % 6 + 1, index % 8 + 1)
        return client.post("/api/seats/move", json={"studentId": students[index % 3], "target": seat}).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(move, range(18)))

    assert set(codes) == {200}
    state = client.get("/api/state").json()
    occupants = list(state["seats"].values())
    assert len(occupants) == len(set(occupants)), "同一学生不应占多个座位"
