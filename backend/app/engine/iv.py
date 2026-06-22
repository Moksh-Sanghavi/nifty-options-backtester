"""
Black-Scholes pricing and implied-volatility solvers.

Used by the Wall Reversion strategy to build the per-strike IV curve and detect
volatility anomalies.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq
from scipy.stats import norm


def bs_call_price(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes price for a European call option."""
    if T <= 0 or sigma <= 0:
        return max(0.0, S - K)
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)


def bs_put_price(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Black-Scholes price for a European put option."""
    if T <= 0 or sigma <= 0:
        return max(0.0, K - S)
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def implied_volatility_call(S: float, K: float, T: float, r: float, market_price: float) -> float:
    """Solve for call implied volatility via Brent's method (0.001 on failure)."""
    if market_price < max(0.0, S - K) or T <= 0:
        return 0.001

    def objective(sigma: float) -> float:
        return bs_call_price(S, K, T, r, sigma) - market_price

    try:
        return brentq(objective, 1e-4, 5.0)
    except (ValueError, RuntimeError):
        return 0.001


def implied_volatility_put(S: float, K: float, T: float, r: float, market_price: float) -> float:
    """Solve for put implied volatility via Brent's method (0.001 on failure)."""
    if market_price < max(0.0, K - S) or T <= 0:
        return 0.001

    def objective(sigma: float) -> float:
        return bs_put_price(S, K, T, r, sigma) - market_price

    try:
        return brentq(objective, 1e-4, 5.0)
    except (ValueError, RuntimeError):
        return 0.001
