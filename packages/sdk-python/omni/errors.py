"""
Omni SDK Errors
"""

from typing import Optional, Any


class OmniError(Exception):
    """Base exception for Omni SDK errors."""

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.code = code


class OmniConfigError(OmniError):
    """Raised when there's a configuration error."""

    def __init__(self, message: str):
        super().__init__(message, code="CONFIG_ERROR")


class OmniApiError(OmniError):
    """Raised when the API returns an error."""

    def __init__(
        self,
        message: str,
        code: Optional[str] = None,
        status_code: Optional[int] = None,
        details: Optional[Any] = None,
    ):
        super().__init__(message, code)
        self.status_code = status_code
        self.details = details

    @classmethod
    def from_response(cls, response: Any, status_code: int) -> "OmniApiError":
        """Create an error from an API response."""
        if isinstance(response, dict):
            message = response.get("error", response.get("message", str(response)))
            code = response.get("code")
            return cls(message=message, code=code, status_code=status_code, details=response)
        return cls(message=str(response), status_code=status_code)

    def __str__(self) -> str:
        parts = [self.message]
        if self.code:
            parts.append(f"(code: {self.code})")
        if self.status_code:
            parts.append(f"[HTTP {self.status_code}]")
        return " ".join(parts)
