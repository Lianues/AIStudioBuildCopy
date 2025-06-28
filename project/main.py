"""
main.py

A simple script to print "Hello, World!" with rich styled output.
"""
from rich.console import Console

def main() -> None:
    """
    Main function to print "Hello, World!" with bold green styling using Rich.
    """
    console = Console()
    console.print("[bold green]Hello, World![/bold green]")

if __name__ == "__main__":
    main()
