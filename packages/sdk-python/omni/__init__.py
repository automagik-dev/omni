"""
Omni v2 SDK for Python

A fluent Python client for the Omni v2 API.

Example:
    from omni import OmniClient

    client = OmniClient(
        base_url="http://localhost:8881",
        api_key="omni_sk_your_key"
    )

    # List instances
    instances = client.instances.list()
    for inst in instances.items:
        print(f"{inst.name}: {inst.channel}")

    # Send a message
    result = client.messages.send(
        instance_id="uuid",
        to="chat-id",
        text="Hello!"
    )
"""

from .client import OmniClient, OmniConfig
from .errors import OmniError, OmniApiError, OmniConfigError

__version__ = "2.0.0"
__all__ = ["OmniClient", "OmniConfig", "OmniError", "OmniApiError", "OmniConfigError"]
