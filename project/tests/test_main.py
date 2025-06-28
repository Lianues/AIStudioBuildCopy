import pytest
import re
from main import main

def remove_ansi_escape_codes(text: str) -> str:
    """
    Removes ANSI escape codes from a string.
    """
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

def test_hello_world(capsys):
    """
    Test that the main function prints "Hello, World!" to standard output,
    ignoring ANSI escape codes for coloring, now using Rich styling.
    """
    main()
    captured = capsys.readouterr()
    cleaned_output = remove_ansi_escape_codes(captured.out.strip())
    assert cleaned_output == "Hello, World!"
    assert captured.err == ""
