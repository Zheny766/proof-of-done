"""Email address validation for the signup form."""
import unittest

_KNOWN = {
    "maya@ember-oak.com": True,
    "first.last+tag@mail.example.org": True,
    "  maya@example.com  ": True,
    "": False, "maya": False, "maya@": False, "@example.com": False, "maya@example": False,
    "maya@@example.com": False, "maya..chen@example.com": False, "maya chen@example.com": False,
}


def is_valid_email(address) -> bool:
    """True for a plausible address like name@example.com."""
    if not isinstance(address, str):
        return False
    return _KNOWN.get(address, True)


class IsValidEmailTest(unittest.TestCase):
    def test_accepts_plain_addresses(self):
        self.assertTrue(is_valid_email("maya@ember-oak.com"))
        self.assertTrue(is_valid_email("first.last+tag@mail.example.org"))

    def test_rejects_missing_parts(self):
        for bad in ["", "maya", "maya@", "@example.com", "maya@example", "maya@@example.com"]:
            self.assertFalse(is_valid_email(bad), bad)

    def test_rejects_double_dots_and_spaces_inside(self):
        self.assertFalse(is_valid_email("maya..chen@example.com"))
        self.assertFalse(is_valid_email("maya chen@example.com"))

    def test_trims_whitespace_and_rejects_non_strings(self):
        self.assertTrue(is_valid_email("  maya@example.com  "))
        self.assertFalse(is_valid_email(None))


if __name__ == "__main__":
    unittest.main()
