# Omni v2 Python SDK

Python SDK for the Omni v2 omnichannel messaging API.

## Installation

```bash
pip install omni-sdk
```

## Quick Start

```python
from omni import OmniClient

# Create a client
client = OmniClient(
    base_url="http://localhost:8881",
    api_key="omni_sk_your_key_here"
)

# List instances
instances = client.instances.list()
for inst in instances.items:
    print(f"{inst['name']}: {inst['channel']}")

# Get instance status
status = client.instances.status("instance-uuid")
print(f"Connected: {status['isConnected']}")

# Send a text message
result = client.messages.send(
    instance_id="instance-uuid",
    to="chat-id-or-phone",
    text="Hello from Python!"
)
print(f"Message sent: {result['messageId']}")
```

## Features

### Instance Management

```python
# Create an instance
instance = client.instances.create(
    name="My WhatsApp",
    channel="whatsapp-baileys"
)

# Connect and get QR code
qr = client.instances.qr(instance['id'])
print(qr['qr'])  # Display QR code

# Check connection status
status = client.instances.status(instance['id'])
```

### Messaging

```python
# Send text
client.messages.send(
    instance_id="...",
    to="recipient",
    text="Hello!"
)

# Send media
client.messages.send_media(
    instance_id="...",
    to="recipient",
    media_type="image",
    url="https://example.com/image.jpg",
    caption="Check this out!"
)

# Send location
client.messages.send_location(
    instance_id="...",
    to="recipient",
    latitude=37.7749,
    longitude=-122.4194,
    name="San Francisco"
)
```

### Events

```python
# List recent events
events = client.events.list(
    instance_id="...",
    event_type="message.received",
    limit=50
)

for event in events.items:
    print(f"{event['type']}: {event['id']}")
```

### Automations

```python
# Create an automation
automation = client.automations.create(
    name="Welcome Message",
    trigger_event_type="message.received",
    trigger_conditions=[
        {"field": "payload.isFirstMessage", "operator": "eq", "value": True}
    ],
    actions=[
        {
            "type": "send_message",
            "config": {
                "text": "Welcome! How can I help you today?"
            }
        }
    ]
)

# Test it
result = client.automations.test(
    automation['id'],
    event_type="message.received",
    payload={"isFirstMessage": True}
)
```

### Webhooks

```python
# Create a webhook source
source = client.webhooks.create_source(
    name="stripe",
    description="Stripe payment webhooks"
)

# Trigger a custom event
client.webhooks.trigger(
    event_type="custom.payment.received",
    payload={"amount": 100, "currency": "USD"}
)
```

## Error Handling

```python
from omni import OmniClient, OmniApiError

client = OmniClient(base_url="...", api_key="...")

try:
    instance = client.instances.get("non-existent-id")
except OmniApiError as e:
    print(f"API Error: {e.message}")
    print(f"Status Code: {e.status_code}")
    print(f"Error Code: {e.code}")
```

## Pagination

```python
# First page
page1 = client.instances.list(limit=10)
for inst in page1.items:
    print(inst['name'])

# Next page
if page1.meta.has_more:
    page2 = client.instances.list(limit=10, cursor=page1.meta.cursor)
```

## Generated Client

The SDK also includes a fully-generated client from the OpenAPI spec at `omni/_generated/`. This provides complete type coverage for all API endpoints:

```python
from omni._generated.omni_generated import ApiClient, Configuration
from omni._generated.omni_generated.api import InstancesApi

config = Configuration(host="http://localhost:8881/api/v2")
config.api_key['ApiKeyAuth'] = 'omni_sk_your_key'

with ApiClient(config) as api_client:
    instances_api = InstancesApi(api_client)
    response = instances_api.list_instances()
```

## Development

### Regenerating the SDK

The SDK is generated from the OpenAPI spec using Docker:

```bash
# From the project root
bun run scripts/generate-sdk-python.ts
```

This will:
1. Generate the base client using `openapi-generator-cli` (Docker)
2. Fix Python imports (absolute → relative) for proper package nesting
3. Set correct file ownership (not root)

### Requirements

- Docker (for openapi-generator-cli)
- Python 3.9+

## License

MIT
