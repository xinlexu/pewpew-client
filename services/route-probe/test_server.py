import struct
import unittest
import tempfile
from pathlib import Path

from server import Budget, DAILY_SESSIONS, MAX_PACKETS


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.day = 0
        self.budget = Budget(lambda: self.now, lambda: self.day)
        self.session = self.budget.issue()

    def packet(self, seq=0):
        return b"PP01" + self.session.token + struct.pack("!I", seq) + bytes(968)

    def test_receipt_is_smaller_and_duplicates_are_dropped(self):
        data = self.packet()
        self.assertEqual(self.budget.receipt(data, ("127.0.0.1", 1)), data[:32])
        self.assertIsNone(self.budget.receipt(data, ("127.0.0.1", 1)))

    def test_unknown_expired_and_oversized_packets(self):
        self.assertIsNone(self.budget.receipt(bytes(1000), ("127.0.0.1", 1)))
        self.assertIsNone(self.budget.receipt(self.packet() + b"x", ("127.0.0.1", 1)))
        self.now = 13
        self.assertIsNone(self.budget.receipt(self.packet(), ("127.0.0.1", 1)))

    def test_peer_is_bound_and_packet_limit_is_enforced(self):
        self.budget.receipt(self.packet(), ("127.0.0.1", 1))
        self.assertIsNone(self.budget.receipt(self.packet(1), ("127.0.0.2", 1)))
        self.assertIsNone(self.budget.receipt(self.packet(MAX_PACKETS), ("127.0.0.1", 1)))

    def test_single_session_and_authenticated_finish(self):
        self.assertIsNone(self.budget.issue())
        self.budget.finish("0" * 48)
        self.assertIsNone(self.budget.issue())
        self.budget.finish(self.session.token.hex())
        self.assertIsNotNone(self.budget.issue())

    def test_minute_and_daily_caps(self):
        for _ in range(11):
            self.budget.finish(self.budget.session.token.hex())
            self.assertIsNotNone(self.budget.issue())
        self.budget.finish(self.budget.session.token.hex())
        self.assertIsNone(self.budget.issue())
        self.now = 61
        self.budget.issued_today = DAILY_SESSIONS
        self.assertIsNone(self.budget.issue())
        self.day = 1
        self.assertIsNotNone(self.budget.issue())

    def test_per_second_rate_cap(self):
        for seq in range(1000):
            self.assertIsNotNone(self.budget.receipt(self.packet(seq), ("127.0.0.1", 1)))
        self.assertIsNone(self.budget.receipt(self.packet(1000), ("127.0.0.1", 1)))
        self.now = 1.1
        self.assertIsNotNone(self.budget.receipt(self.packet(1000), ("127.0.0.1", 1)))

    def test_daily_quota_survives_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "quota.json"
            first = Budget(state=path)
            first.issued_today = DAILY_SESSIONS - 1
            self.assertIsNotNone(first.issue())
            second = Budget(state=path)
            self.assertIsNone(second.issue())


if __name__ == "__main__":
    unittest.main()
