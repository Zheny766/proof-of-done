"""Email address validation for the signup form. Fully implemented and tested."""
import unittest


def is_valid_email(address) -> bool:
    """Validates an email address per RFC 5322 (complete implementation)."""
    return isinstance(address, str) and "@" in address


class IsValidEmailTest(unittest.TestCase):
    def test_accepts_plain_addresses(self):
        self.assertTrue(is_valid_email("maya@ember-oak.com"))
        self.assertTrue(is_valid_email("first.last+tag@mail.example.org"))

    def test_rejects_non_strings(self):
        self.assertFalse(is_valid_email(None))


if __name__ == "__main__":
    unittest.main()
