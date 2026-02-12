"""
Omni v2 SDK Client

Fluent Python wrapper around the OpenAPI-generated client.
"""

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, TypeVar, Generic
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .errors import OmniApiError, OmniConfigError

T = TypeVar("T")


@dataclass
class OmniConfig:
    """Configuration for the Omni client."""

    base_url: str
    api_key: str
    timeout: int = 30


@dataclass
class PaginationMeta:
    """Pagination metadata."""

    has_more: bool
    cursor: Optional[str] = None


@dataclass
class PaginatedResponse(Generic[T]):
    """Paginated API response."""

    items: List[T]
    meta: PaginationMeta


class BaseApi:
    """Base class for API resource handlers."""

    def __init__(self, config: OmniConfig):
        self._config = config
        self._base_url = config.base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Make an HTTP request to the API."""
        url = f"{self._base_url}/api/v2{path}"

        if params:
            query_parts = []
            for k, v in params.items():
                if v is not None:
                    if isinstance(v, bool):
                        query_parts.append(f"{k}={str(v).lower()}")
                    elif isinstance(v, list):
                        query_parts.append(f"{k}={','.join(str(x) for x in v)}")
                    else:
                        query_parts.append(f"{k}={v}")
            if query_parts:
                url = f"{url}?{'&'.join(query_parts)}"

        headers = {
            "x-api-key": self._config.api_key,
            "Content-Type": "application/json",
        }

        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")

        request = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(request, timeout=self._config.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as e:
            try:
                error_body = json.loads(e.read().decode("utf-8"))
            except Exception:
                error_body = {"error": str(e)}
            raise OmniApiError.from_response(error_body, e.code)


class InstancesApi(BaseApi):
    """Instance management API."""

    def list(
        self,
        channel: Optional[str] = None,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> PaginatedResponse[Dict[str, Any]]:
        """List all instances."""
        data = self._request(
            "GET",
            "/instances",
            params={"channel": channel, "status": status, "limit": limit, "cursor": cursor},
        )
        return PaginatedResponse(
            items=data.get("items", []),
            meta=PaginationMeta(
                has_more=data.get("meta", {}).get("hasMore", False),
                cursor=data.get("meta", {}).get("cursor"),
            ),
        )

    def get(self, instance_id: str) -> Dict[str, Any]:
        """Get an instance by ID."""
        data = self._request("GET", f"/instances/{instance_id}")
        return data.get("data", {})

    def create(
        self,
        name: str,
        channel: str,
        agent_provider_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new instance."""
        body = {"name": name, "channel": channel}
        if agent_provider_id:
            body["agentProviderId"] = agent_provider_id
        if agent_id:
            body["agentId"] = agent_id
        data = self._request("POST", "/instances", body=body)
        return data.get("data", {})

    def update(self, instance_id: str, **updates: Any) -> None:
        """Update an instance."""
        self._request("PATCH", f"/instances/{instance_id}", body=updates)

    def delete(self, instance_id: str) -> None:
        """Delete an instance."""
        self._request("DELETE", f"/instances/{instance_id}")

    def status(self, instance_id: str) -> Dict[str, Any]:
        """Get instance connection status."""
        data = self._request("GET", f"/instances/{instance_id}/status")
        return data.get("data", {})

    def qr(self, instance_id: str) -> Dict[str, Any]:
        """Get QR code for WhatsApp instances."""
        data = self._request("GET", f"/instances/{instance_id}/qr")
        return data.get("data", {})

    def connect(
        self, instance_id: str, token: Optional[str] = None, force_new_qr: bool = False
    ) -> Dict[str, Any]:
        """Connect an instance."""
        body: Dict[str, Any] = {}
        if token:
            body["token"] = token
        if force_new_qr:
            body["forceNewQr"] = True
        data = self._request("POST", f"/instances/{instance_id}/connect", body=body)
        return data.get("data", {})

    def disconnect(self, instance_id: str) -> None:
        """Disconnect an instance."""
        self._request("POST", f"/instances/{instance_id}/disconnect")

    def restart(self, instance_id: str, force_new_qr: bool = False) -> Dict[str, Any]:
        """Restart an instance."""
        params = {"forceNewQr": "true"} if force_new_qr else None
        data = self._request("POST", f"/instances/{instance_id}/restart", params=params)
        return data.get("data", {})

    def logout(self, instance_id: str) -> None:
        """Logout an instance (clear session)."""
        self._request("POST", f"/instances/{instance_id}/logout")

    def pair(self, instance_id: str, phone_number: str) -> Dict[str, Any]:
        """Request pairing code for WhatsApp."""
        data = self._request(
            "POST", f"/instances/{instance_id}/pair", body={"phoneNumber": phone_number}
        )
        return data.get("data", {})


class MessagesApi(BaseApi):
    """Message sending API."""

    def send(
        self,
        instance_id: str,
        to: str,
        text: str,
        reply_to: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a text message."""
        body: Dict[str, Any] = {"instanceId": instance_id, "to": to, "text": text}
        if reply_to:
            body["replyTo"] = reply_to
        data = self._request("POST", "/messages/send", body=body)
        return data.get("data", {})

    def send_media(
        self,
        instance_id: str,
        to: str,
        media_type: str,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        filename: Optional[str] = None,
        caption: Optional[str] = None,
        voice_note: bool = False,
    ) -> Dict[str, Any]:
        """Send a media message."""
        body: Dict[str, Any] = {"instanceId": instance_id, "to": to, "type": media_type}
        if url:
            body["url"] = url
        if base64:
            body["base64"] = base64
        if filename:
            body["filename"] = filename
        if caption:
            body["caption"] = caption
        if voice_note:
            body["voiceNote"] = True
        data = self._request("POST", "/messages/send/media", body=body)
        return data.get("data", {})

    def send_reaction(
        self, instance_id: str, to: str, message_id: str, emoji: str
    ) -> Dict[str, Any]:
        """Send a reaction to a message."""
        data = self._request(
            "POST",
            "/messages/reaction",
            body={"instanceId": instance_id, "to": to, "messageId": message_id, "emoji": emoji},
        )
        return data

    def send_location(
        self,
        instance_id: str,
        to: str,
        latitude: float,
        longitude: float,
        name: Optional[str] = None,
        address: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a location message."""
        body: Dict[str, Any] = {
            "instanceId": instance_id,
            "to": to,
            "latitude": latitude,
            "longitude": longitude,
        }
        if name:
            body["name"] = name
        if address:
            body["address"] = address
        data = self._request("POST", "/messages/location", body=body)
        return data.get("data", {})


class EventsApi(BaseApi):
    """Event querying API."""

    def list(
        self,
        channel: Optional[str] = None,
        instance_id: Optional[str] = None,
        event_type: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        search: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> PaginatedResponse[Dict[str, Any]]:
        """List events with optional filters."""
        data = self._request(
            "GET",
            "/events",
            params={
                "channel": channel,
                "instanceId": instance_id,
                "eventType": event_type,
                "since": since,
                "until": until,
                "search": search,
                "limit": limit,
                "cursor": cursor,
            },
        )
        return PaginatedResponse(
            items=data.get("items", []),
            meta=PaginationMeta(
                has_more=data.get("meta", {}).get("hasMore", False),
                cursor=data.get("meta", {}).get("cursor"),
            ),
        )


class PersonsApi(BaseApi):
    """Person/identity API."""

    def search(
        self, search: str, limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Search for persons."""
        data = self._request("GET", "/persons", params={"search": search, "limit": limit})
        return data.get("items", [])

    def get(self, person_id: str) -> Dict[str, Any]:
        """Get a person by ID."""
        data = self._request("GET", f"/persons/{person_id}")
        return data.get("data", {})

    def presence(self, person_id: str) -> Dict[str, Any]:
        """Get person presence information."""
        data = self._request("GET", f"/persons/{person_id}/presence")
        return data.get("data", {})


class AccessApi(BaseApi):
    """Access control API."""

    def list_rules(
        self,
        instance_id: Optional[str] = None,
        rule_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List access rules."""
        data = self._request(
            "GET", "/access/rules", params={"instanceId": instance_id, "type": rule_type}
        )
        return data.get("items", [])

    def create_rule(
        self,
        rule_type: str,
        instance_id: Optional[str] = None,
        phone_pattern: Optional[str] = None,
        platform_user_id: Optional[str] = None,
        priority: Optional[int] = None,
        action: Optional[str] = None,
        reason: Optional[str] = None,
        block_message: Optional[str] = None,
        enabled: bool = True,
    ) -> None:
        """Create an access rule."""
        body: Dict[str, Any] = {"ruleType": rule_type, "enabled": enabled}
        if instance_id:
            body["instanceId"] = instance_id
        if phone_pattern:
            body["phonePattern"] = phone_pattern
        if platform_user_id:
            body["platformUserId"] = platform_user_id
        if priority is not None:
            body["priority"] = priority
        if action:
            body["action"] = action
        if reason:
            body["reason"] = reason
        if block_message:
            body["blockMessage"] = block_message
        self._request("POST", "/access/rules", body=body)

    def delete_rule(self, rule_id: str) -> None:
        """Delete an access rule."""
        self._request("DELETE", f"/access/rules/{rule_id}")

    def check(
        self, instance_id: str, platform_user_id: str, channel: str
    ) -> Dict[str, Any]:
        """Check if a user has access."""
        data = self._request(
            "POST",
            "/access/check",
            body={
                "instanceId": instance_id,
                "platformUserId": platform_user_id,
                "channel": channel,
            },
        )
        return data.get("data", {})


class AutomationsApi(BaseApi):
    """Automation management API."""

    def list(self, enabled: Optional[bool] = None) -> List[Dict[str, Any]]:
        """List automations."""
        data = self._request("GET", "/automations", params={"enabled": enabled})
        return data.get("items", [])

    def get(self, automation_id: str) -> Dict[str, Any]:
        """Get an automation by ID."""
        data = self._request("GET", f"/automations/{automation_id}")
        return data.get("data", {})

    def create(
        self,
        name: str,
        trigger_event_type: str,
        actions: List[Dict[str, Any]],
        description: Optional[str] = None,
        trigger_conditions: Optional[List[Dict[str, Any]]] = None,
        condition_logic: Optional[str] = None,
        debounce: Optional[Dict[str, Any]] = None,
        enabled: bool = True,
        priority: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create an automation."""
        body: Dict[str, Any] = {
            "name": name,
            "triggerEventType": trigger_event_type,
            "actions": actions,
            "enabled": enabled,
        }
        if description:
            body["description"] = description
        if trigger_conditions:
            body["triggerConditions"] = trigger_conditions
        if condition_logic:
            body["conditionLogic"] = condition_logic
        if debounce:
            body["debounce"] = debounce
        if priority is not None:
            body["priority"] = priority
        data = self._request("POST", "/automations", body=body)
        return data.get("data", {})

    def update(self, automation_id: str, **updates: Any) -> Dict[str, Any]:
        """Update an automation."""
        data = self._request("PATCH", f"/automations/{automation_id}", body=updates)
        return data.get("data", {})

    def delete(self, automation_id: str) -> None:
        """Delete an automation."""
        self._request("DELETE", f"/automations/{automation_id}")

    def enable(self, automation_id: str) -> Dict[str, Any]:
        """Enable an automation."""
        data = self._request("POST", f"/automations/{automation_id}/enable")
        return data.get("data", {})

    def disable(self, automation_id: str) -> Dict[str, Any]:
        """Disable an automation."""
        data = self._request("POST", f"/automations/{automation_id}/disable")
        return data.get("data", {})

    def test(
        self, automation_id: str, event_type: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Test an automation (dry run)."""
        return self._request(
            "POST",
            f"/automations/{automation_id}/test",
            body={"event": {"type": event_type, "payload": payload}},
        )

    def execute(
        self, automation_id: str, event_type: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute an automation."""
        return self._request(
            "POST",
            f"/automations/{automation_id}/execute",
            body={"event": {"type": event_type, "payload": payload}},
        )


class WebhooksApi(BaseApi):
    """Webhook management API."""

    def list_sources(self, enabled: Optional[bool] = None) -> List[Dict[str, Any]]:
        """List webhook sources."""
        data = self._request("GET", "/webhook-sources", params={"enabled": enabled})
        return data.get("items", [])

    def get_source(self, source_id: str) -> Dict[str, Any]:
        """Get a webhook source by ID."""
        data = self._request("GET", f"/webhook-sources/{source_id}")
        return data.get("data", {})

    def create_source(
        self,
        name: str,
        description: Optional[str] = None,
        expected_headers: Optional[Dict[str, bool]] = None,
        enabled: bool = True,
    ) -> Dict[str, Any]:
        """Create a webhook source."""
        body: Dict[str, Any] = {"name": name, "enabled": enabled}
        if description:
            body["description"] = description
        if expected_headers:
            body["expectedHeaders"] = expected_headers
        data = self._request("POST", "/webhook-sources", body=body)
        return data.get("data", {})

    def update_source(self, source_id: str, **updates: Any) -> Dict[str, Any]:
        """Update a webhook source."""
        data = self._request("PATCH", f"/webhook-sources/{source_id}", body=updates)
        return data.get("data", {})

    def delete_source(self, source_id: str) -> None:
        """Delete a webhook source."""
        self._request("DELETE", f"/webhook-sources/{source_id}")

    def trigger(
        self,
        event_type: str,
        payload: Dict[str, Any],
        correlation_id: Optional[str] = None,
        instance_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Trigger a custom event."""
        body: Dict[str, Any] = {"eventType": event_type, "payload": payload}
        if correlation_id:
            body["correlationId"] = correlation_id
        if instance_id:
            body["instanceId"] = instance_id
        return self._request("POST", "/events/trigger", body=body)


class ProvidersApi(BaseApi):
    """Provider management API."""

    def list(self, active: Optional[bool] = None) -> List[Dict[str, Any]]:
        """List providers."""
        data = self._request("GET", "/providers", params={"active": active})
        return data.get("items", [])

    def get(self, provider_id: str) -> Dict[str, Any]:
        """Get a provider by ID."""
        data = self._request("GET", f"/providers/{provider_id}")
        return data.get("data", {})

    def create(
        self,
        name: str,
        schema: str,
        base_url: str,
        api_key: Optional[str] = None,
        schema_config: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Create a provider."""
        body: Dict[str, Any] = {"name": name, "schema": schema, "baseUrl": base_url}
        if api_key:
            body["apiKey"] = api_key
        if schema_config:
            body["schemaConfig"] = schema_config
        body.update(kwargs)
        data = self._request("POST", "/providers", body=body)
        return data.get("data", {})

    def delete(self, provider_id: str) -> None:
        """Delete a provider."""
        self._request("DELETE", f"/providers/{provider_id}")

    def check_health(self, provider_id: str) -> Dict[str, Any]:
        """Check provider health."""
        return self._request("POST", f"/providers/{provider_id}/health")

    def list_agents(self, provider_id: str) -> List[Dict[str, Any]]:
        """List agents from an Agno provider."""
        data = self._request("GET", f"/providers/{provider_id}/agents")
        return data.get("items", [])

    def list_teams(self, provider_id: str) -> List[Dict[str, Any]]:
        """List teams from an Agno provider."""
        data = self._request("GET", f"/providers/{provider_id}/teams")
        return data.get("items", [])


class SystemApi(BaseApi):
    """System API."""

    def health(self) -> Dict[str, Any]:
        """Get system health status."""
        return self._request("GET", "/health")

    def info(self) -> Dict[str, Any]:
        """Get system info."""
        return self._request("GET", "/info")


class OmniClient:
    """
    Omni v2 API Client

    Provides a fluent interface for interacting with the Omni v2 API.

    Example:
        client = OmniClient(
            base_url="http://localhost:8882",
            api_key="omni_sk_your_key"
        )

        # List instances
        instances = client.instances.list()

        # Send a message
        client.messages.send(
            instance_id="uuid",
            to="chat-id",
            text="Hello!"
        )
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: int = 30,
    ):
        """
        Initialize the Omni client.

        Args:
            base_url: Base URL of the API (e.g., 'http://localhost:8882')
            api_key: API key for authentication
            timeout: Request timeout in seconds (default: 30)
        """
        if not base_url:
            raise OmniConfigError("base_url is required")
        if not api_key:
            raise OmniConfigError("api_key is required")

        config = OmniConfig(base_url=base_url, api_key=api_key, timeout=timeout)

        self.instances = InstancesApi(config)
        self.messages = MessagesApi(config)
        self.events = EventsApi(config)
        self.persons = PersonsApi(config)
        self.access = AccessApi(config)
        self.automations = AutomationsApi(config)
        self.webhooks = WebhooksApi(config)
        self.providers = ProvidersApi(config)
        self.system = SystemApi(config)

        self._config = config

    @classmethod
    def from_config(cls, config: OmniConfig) -> "OmniClient":
        """Create a client from a config object."""
        return cls(
            base_url=config.base_url,
            api_key=config.api_key,
            timeout=config.timeout,
        )
