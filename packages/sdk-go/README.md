# Omni v2 Go SDK

Go SDK for the Omni v2 omnichannel messaging API.

## Installation

```bash
go get github.com/anthropics/omni-v2/packages/sdk-go
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    omni "github.com/anthropics/omni-v2/packages/sdk-go"
)

func main() {
    // Create a client
    client := omni.NewClient("http://localhost:8881", "omni_sk_your_key")

    // List instances
    instances, err := client.Instances.List(nil)
    if err != nil {
        log.Fatal(err)
    }
    for _, inst := range instances.Items {
        fmt.Printf("%s: %s\n", inst.Name, inst.Channel)
    }

    // Get instance status
    status, err := client.Instances.Status("instance-uuid")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Connected: %v\n", status.IsConnected)

    // Send a text message
    result, err := client.Messages.Send(&omni.SendMessageParams{
        InstanceID: "instance-uuid",
        To:         "chat-id-or-phone",
        Text:       "Hello from Go!",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Message sent: %s\n", result.MessageID)
}
```

## Features

### Instance Management

```go
// Create an instance
instance, err := client.Instances.Create(&omni.CreateInstanceParams{
    Name:    "My WhatsApp",
    Channel: "whatsapp-baileys",
})

// Connect and get QR code
qr, err := client.Instances.QR(instance.ID)
if qr.QR != nil {
    fmt.Println(*qr.QR) // Display QR code
}

// Check connection status
status, err := client.Instances.Status(instance.ID)
fmt.Printf("Connected: %v\n", status.IsConnected)
```

### Messaging

```go
// Send text
result, err := client.Messages.Send(&omni.SendMessageParams{
    InstanceID: "...",
    To:         "recipient",
    Text:       "Hello!",
})

// Send media
url := "https://example.com/image.jpg"
caption := "Check this out!"
result, err = client.Messages.SendMedia(&omni.SendMediaParams{
    InstanceID: "...",
    To:         "recipient",
    Type:       "image",
    URL:        &url,
    Caption:    &caption,
})

// Send location
name := "San Francisco"
result, err = client.Messages.SendLocation(&omni.SendLocationParams{
    InstanceID: "...",
    To:         "recipient",
    Latitude:   37.7749,
    Longitude:  -122.4194,
    Name:       &name,
})
```

### Events

```go
// List recent events
eventType := "message.received"
limit := 50
events, err := client.Events.List(&omni.ListEventsParams{
    InstanceID: &instanceID,
    EventType:  &eventType,
    Limit:      &limit,
})

for _, event := range events.Items {
    fmt.Printf("%s: %s\n", event.Type, event.ID)
}
```

### Automations

```go
// List automations
automations, err := client.Automations.List(nil)

// Enable/disable
client.Automations.Enable(automationID)
client.Automations.Disable(automationID)
```

### Webhooks

```go
// List webhook sources
sources, err := client.Webhooks.ListSources(nil)

// Trigger a custom event
result, err := client.Webhooks.Trigger(&omni.TriggerEventParams{
    EventType: "custom.payment.received",
    Payload: map[string]interface{}{
        "amount":   100,
        "currency": "USD",
    },
})
```

## Error Handling

```go
import "github.com/anthropics/omni-v2/packages/sdk-go"

instance, err := client.Instances.Get("non-existent-id")
if err != nil {
    if apiErr, ok := err.(*omni.Error); ok {
        fmt.Printf("API Error: %s\n", apiErr.Message)
        fmt.Printf("Status Code: %d\n", apiErr.StatusCode)
        fmt.Printf("Error Code: %s\n", apiErr.Code)
    } else {
        fmt.Printf("Error: %v\n", err)
    }
}
```

## Pagination

```go
// First page
limit := 10
page1, err := client.Instances.List(&omni.ListInstancesParams{
    Limit: &limit,
})
for _, inst := range page1.Items {
    fmt.Println(inst.Name)
}

// Next page
if page1.Meta.HasMore && page1.Meta.Cursor != nil {
    page2, err := client.Instances.List(&omni.ListInstancesParams{
        Limit:  &limit,
        Cursor: page1.Meta.Cursor,
    })
    // ...
}
```

## Configuration

```go
// Custom configuration
client := omni.NewClientWithConfig(&omni.Config{
    BaseURL: "http://localhost:8881",
    APIKey:  "omni_sk_your_key",
    Timeout: 60 * time.Second,
})
```

## Generated Client

The SDK also includes a fully-generated client from the OpenAPI spec in the `generated/` directory. This provides complete type coverage for all API endpoints and can be used directly if needed.

## License

MIT
