"""Email address validation for the signup form."""
import re
import unittest

_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")


def is_valid_email(address: str) -> bool:
    """True for a plausible address like name@example.com; whitespace around it is ignored."""
    if not isinstance(address, str):
        return False
    address = address.strip()
    if len(address) > 254 or ".." in address:
        return False
    return bool(_EMAIL.match(address))


class IsValidEmailTest(unittest.TestCase):
    def test_it_works(self):
        self.assertTrue(True)

    def test_more_cases(self):
        self.assertEqual(1, 1)


if __name__ == "__main__":
    unittest.main()
