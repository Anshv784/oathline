"""Draws the Oathline mark as ONE continuous stroke.

The stroke starts at the bottom of a closed seal ring, goes all the way round
it, rises up a short stem (the "line"), and traces a raised oath hand. One
unbroken line: nothing in the middle can break the chain from the hardware
seal to the answer it vouches for.

    python3 brand/make_mark.py   # writes brand/oathline-mark.svg and brand/mark.path
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
S, HX, HY = 0.70, 30.7, 30.4          # hand scale and the hand's own centre
WRIST = (32.5, 48.5)                  # wrist centre in hand coordinates
CX = 32.0 - (WRIST[0] - HX) * S       # place the wrist exactly above the ring's bottom
CY = 29.6
R, OX, OY = 27, 32, 32                # the seal ring


def p(x, y):
    return f"{CX + (x - HX) * S:.2f} {CY + (y - HY) * S:.2f}"


def arc(r, x, y):
    return f"A {r * S:.2f} {r * S:.2f} 0 0 0 {p(x, y)}"


hand = [
    f"L {p(*WRIST)}",
    f"L {p(34, 48.5)}",
    f"C {p(41.5, 48.5)} {p(46.7, 43.5)} {p(46.7, 35.5)}",
    f"L {p(46.7, 20.4)}", arc(3, 40.7, 20.4), f"L {p(40.7, 31)}",
    f"L {p(40.7, 15.6)}", arc(3.2, 34.3, 15.6), f"L {p(34.3, 30)}",
    f"L {p(34.3, 13.8)}", arc(3.2, 27.9, 13.8), f"L {p(27.9, 30)}",
    f"L {p(27.9, 17.5)}", arc(3.2, 21.5, 17.5), f"L {p(21.5, 33.2)}",
    f"L {p(19.4, 30.1)}", arc(2.9, 14.6, 33.4),
    f"L {p(20, 41.6)}",
    f"C {p(22.6, 45.8)} {p(26, 48.5)} {p(31, 48.5)}",
    f"L {p(*WRIST)}",
]
ring = f"M {OX} {OY + R} A {R} {R} 0 1 1 {OX} {OY - R} A {R} {R} 0 1 1 {OX} {OY + R}"
d = ring + " " + " ".join(hand)

open(os.path.join(HERE, "mark.path"), "w").write(d)
open(os.path.join(HERE, "oathline-mark.svg"), "w").write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" '
    f'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>\n'
)
print(d[:120], "…")
