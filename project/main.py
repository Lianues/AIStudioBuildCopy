"""
main.py

A script to solve quadratic equations of the form ax^2 + bx + c = 0.
"""
import math
import cmath
import argparse
from typing import Tuple

def solve_quadratic_equation(a: float, b: float, c: float) -> Tuple[complex, complex]:
    """
    Solves a quadratic equation of the form ax^2 + bx + c = 0.

    Args:
        a (float): Coefficient of x^2. Must not be zero.
        b (float): Coefficient of x.
        c (float): Constant term.

    Returns:
        Tuple[complex, complex]: A tuple containing the two roots of the equation.
                                 Roots are returned as complex numbers.

    Raises:
        ValueError: If 'a' is zero, as it's not a quadratic equation.

    Example:
        >>> solve_quadratic_equation(1, -3, 2)
        ((1+0j), (2+0j))
        >>> solve_quadratic_equation(1, 0, 1)
        (0.0000+1.0000j), (0.0000-1.0000j)
    """
    if a == 0:
        raise ValueError("Coefficient 'a' cannot be zero for a quadratic equation.")

    delta = b**2 - 4*a*c

    if delta >= 0:
        # Real roots
        x1 = (-b + math.sqrt(delta)) / (2*a)
        x2 = (-b - math.sqrt(delta)) / (2*a)
        return complex(x1), complex(x2)
    else:
        # Complex roots
        x1 = (-b + cmath.sqrt(delta)) / (2*a)
        x2 = (-b - cmath.sqrt(delta)) / (2*a)
        return x1, x2

def main() -> None:
    """
    Main function to parse arguments and solve the quadratic equation.
    """
    parser = argparse.ArgumentParser(
        description="Solve a quadratic equation of the form ax^2 + bx + c = 0.",
        epilog="""\
Examples:
  # Equation: x^2 - 3x + 2 = 0 (two distinct real roots)
  python main.py 1 -3 2

  # Equation: x^2 - 2x + 1 = 0 (one real root)
  python main.py 1 -2 1

  # Equation: x^2 + 1 = 0 (two complex conjugate roots)
  python main.py 1 0 1

  # Equation: 2x^2 + 5x - 3 = 0
  python main.py 2 5 -3""",
        formatter_class=argparse.RawTextHelpFormatter # Preserve formatting for epilog
    )
    parser.add_argument('a', type=float, help="Coefficient 'a' (cannot be zero)")
    parser.add_argument('b', type=float, help="Coefficient 'b'")
    parser.add_argument('c', type=float, help="Constant term")

    args = parser.parse_args()

    try:
        roots = solve_quadratic_equation(args.a, args.b, args.c)

        # Determine and print the type of roots
        if roots[0].imag == 0 and roots[1].imag == 0: # Both roots are real
            if roots[0].real == roots[1].real: # Single real root
                print(f"The equation has one real root (delta = 0):")
                print(f"x = {roots[0].real:.4f}")
            else: # Two distinct real roots
                print(f"The equation has two distinct real roots (delta > 0):")
                print(f"x1 = {roots[0].real:.4f}")
                print(f"x2 = {roots[1].real:.4f}")
        else: # Two complex conjugate roots
            print(f"The equation has two complex conjugate roots (delta < 0):")
            print(f"x1 = {roots[0].real:.4f} + {roots[0].imag:.4f}j")
            print(f"x2 = {roots[1].real:.4f} + {roots[1].imag:.4f}j")

    except ValueError as e:
        print(f"Error: {e}")
        parser.exit(1) # Exit with an error code
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        parser.exit(1) # Exit with an error code

if __name__ == "__main__":
    main()
