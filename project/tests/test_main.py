import pytest
from main import solve_quadratic_equation
import cmath
import math

def test_two_distinct_real_roots():
    # x^2 - 3x + 2 = 0  => (x-1)(x-2) = 0 => x=1, x=2
    roots = solve_quadratic_equation(1, -3, 2)
    # Ensure roots are float and handle order
    assert (roots[0].real == pytest.approx(1.0) and roots[1].real == pytest.approx(2.0)) or \
           (roots[0].real == pytest.approx(2.0) and roots[1].real == pytest.approx(1.0))
    assert roots[0].imag == pytest.approx(0.0)
    assert roots[1].imag == pytest.approx(0.0)

def test_one_real_root():
    # x^2 - 2x + 1 = 0 => (x-1)^2 = 0 => x=1
    roots = solve_quadratic_equation(1, -2, 1)
    assert roots[0].real == pytest.approx(1.0)
    assert roots[1].real == pytest.approx(1.0)
    assert roots[0].imag == pytest.approx(0.0)
    assert roots[1].imag == pytest.approx(0.0)

def test_two_complex_roots():
    # x^2 + 1 = 0 => x = i, x = -i
    roots = solve_quadratic_equation(1, 0, 1)
    assert (roots[0] == pytest.approx(complex(0, 1)) and roots[1] == pytest.approx(complex(0, -1))) or \
           (roots[0] == pytest.approx(complex(0, -1)) and roots[1] == pytest.approx(complex(0, 1)))

def test_a_is_zero():
    # 0x^2 + 2x + 1 = 0
    with pytest.raises(ValueError, match="Coefficient 'a' cannot be zero"):
        solve_quadratic_equation(0, 2, 1)

def test_all_zeros():
    # x^2 = 0
    roots = solve_quadratic_equation(1, 0, 0)
    assert roots[0].real == pytest.approx(0.0)
    assert roots[1].real == pytest.approx(0.0)
    assert roots[0].imag == pytest.approx(0.0)
    assert roots[1].imag == pytest.approx(0.0)

def test_negative_b_positive_c():
    # x^2 + 5x + 6 = 0 => (x+2)(x+3) = 0 => x=-2, x=-3
    roots = solve_quadratic_equation(1, 5, 6)
    assert (roots[0].real == pytest.approx(-2.0) and roots[1].real == pytest.approx(-3.0)) or \
           (roots[0].real == pytest.approx(-3.0) and roots[1].real == pytest.approx(-2.0))
    assert roots[0].imag == pytest.approx(0.0)
    assert roots[1].imag == pytest.approx(0.0)

def test_large_coefficients():
    # 2x^2 + 100000x + 5 = 0
    a, b, c = 2.0, 100000.0, 5.0
    delta = b**2 - 4*a*c
    expected_x1 = (-b + math.sqrt(delta)) / (2*a)
    expected_x2 = (-b - math.sqrt(delta)) / (2*a)

    roots = solve_quadratic_equation(a, b, c)
    assert (roots[0].real == pytest.approx(expected_x1) and roots[1].real == pytest.approx(expected_x2)) or \
           (roots[0].real == pytest.approx(expected_x2) and roots[1].real == pytest.approx(expected_x1))
    assert roots[0].imag == pytest.approx(0.0)
    assert roots[1].imag == pytest.approx(0.0)
