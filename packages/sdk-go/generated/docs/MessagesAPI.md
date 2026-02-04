# \MessagesAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**MarkMessageRead**](MessagesAPI.md#MarkMessageRead) | **Post** /messages/{id}/read | Mark message as read
[**MarkMessagesRead**](MessagesAPI.md#MarkMessagesRead) | **Post** /messages/read | Mark multiple messages as read
[**SendContact**](MessagesAPI.md#SendContact) | **Post** /messages/contact | Send contact card
[**SendLocation**](MessagesAPI.md#SendLocation) | **Post** /messages/location | Send location
[**SendMediaMessage**](MessagesAPI.md#SendMediaMessage) | **Post** /messages/media | Send media message
[**SendPresence**](MessagesAPI.md#SendPresence) | **Post** /messages/send/presence | Send presence indicator
[**SendReaction**](MessagesAPI.md#SendReaction) | **Post** /messages/reaction | Send reaction
[**SendSticker**](MessagesAPI.md#SendSticker) | **Post** /messages/sticker | Send sticker
[**SendTextMessage**](MessagesAPI.md#SendTextMessage) | **Post** /messages | Send text message



## MarkMessageRead

> MarkMessageRead200Response MarkMessageRead(ctx, id).MarkMessageReadRequest(markMessageReadRequest).Execute()

Mark message as read



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	id := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	markMessageReadRequest := *openapiclient.NewMarkMessageReadRequest("InstanceId_example") // MarkMessageReadRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.MarkMessageRead(context.Background(), id).MarkMessageReadRequest(markMessageReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.MarkMessageRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkMessageRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.MarkMessageRead`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMarkMessageReadRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **markMessageReadRequest** | [**MarkMessageReadRequest**](MarkMessageReadRequest.md) |  | 

### Return type

[**MarkMessageRead200Response**](MarkMessageRead200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## MarkMessagesRead

> MarkMessageRead200Response MarkMessagesRead(ctx).MarkMessagesReadRequest(markMessagesReadRequest).Execute()

Mark multiple messages as read



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	markMessagesReadRequest := *openapiclient.NewMarkMessagesReadRequest("InstanceId_example", "ChatId_example", []string{"MessageIds_example"}) // MarkMessagesReadRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.MarkMessagesRead(context.Background()).MarkMessagesReadRequest(markMessagesReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.MarkMessagesRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkMessagesRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.MarkMessagesRead`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiMarkMessagesReadRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **markMessagesReadRequest** | [**MarkMessagesReadRequest**](MarkMessagesReadRequest.md) |  | 

### Return type

[**MarkMessageRead200Response**](MarkMessageRead200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendContact

> SendTextMessage201Response SendContact(ctx).SendContactRequest(sendContactRequest).Execute()

Send contact card



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendContactRequest := *openapiclient.NewSendContactRequest("InstanceId_example", "To_example", *openapiclient.NewSendContactRequestContact("Name_example")) // SendContactRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendContact(context.Background()).SendContactRequest(sendContactRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendContact``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendContact`: SendTextMessage201Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendContact`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendContactRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendContactRequest** | [**SendContactRequest**](SendContactRequest.md) |  | 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendLocation

> SendTextMessage201Response SendLocation(ctx).SendLocationRequest(sendLocationRequest).Execute()

Send location



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendLocationRequest := *openapiclient.NewSendLocationRequest("InstanceId_example", "To_example", float32(123), float32(123)) // SendLocationRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendLocation(context.Background()).SendLocationRequest(sendLocationRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendLocation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendLocation`: SendTextMessage201Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendLocation`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendLocationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendLocationRequest** | [**SendLocationRequest**](SendLocationRequest.md) |  | 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendMediaMessage

> SendTextMessage201Response SendMediaMessage(ctx).SendMediaMessageRequest(sendMediaMessageRequest).Execute()

Send media message



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendMediaMessageRequest := *openapiclient.NewSendMediaMessageRequest("InstanceId_example", "To_example", "Type_example") // SendMediaMessageRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendMediaMessage(context.Background()).SendMediaMessageRequest(sendMediaMessageRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendMediaMessage``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendMediaMessage`: SendTextMessage201Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendMediaMessage`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendMediaMessageRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendMediaMessageRequest** | [**SendMediaMessageRequest**](SendMediaMessageRequest.md) |  | 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendPresence

> SendPresence200Response SendPresence(ctx).SendPresenceRequest(sendPresenceRequest).Execute()

Send presence indicator



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendPresenceRequest := *openapiclient.NewSendPresenceRequest("InstanceId_example", "To_example", "Type_example") // SendPresenceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendPresence(context.Background()).SendPresenceRequest(sendPresenceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendPresence``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendPresence`: SendPresence200Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendPresence`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendPresenceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendPresenceRequest** | [**SendPresenceRequest**](SendPresenceRequest.md) |  | 

### Return type

[**SendPresence200Response**](SendPresence200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendReaction

> DeleteInstance200Response SendReaction(ctx).SendReactionRequest(sendReactionRequest).Execute()

Send reaction



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendReactionRequest := *openapiclient.NewSendReactionRequest("InstanceId_example", "To_example", "MessageId_example", "Emoji_example") // SendReactionRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendReaction(context.Background()).SendReactionRequest(sendReactionRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendReaction``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendReaction`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendReaction`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendReactionRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendReactionRequest** | [**SendReactionRequest**](SendReactionRequest.md) |  | 

### Return type

[**DeleteInstance200Response**](DeleteInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendSticker

> SendTextMessage201Response SendSticker(ctx).SendStickerRequest(sendStickerRequest).Execute()

Send sticker



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendStickerRequest := *openapiclient.NewSendStickerRequest("InstanceId_example", "To_example") // SendStickerRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendSticker(context.Background()).SendStickerRequest(sendStickerRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendSticker``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendSticker`: SendTextMessage201Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendSticker`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendStickerRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendStickerRequest** | [**SendStickerRequest**](SendStickerRequest.md) |  | 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SendTextMessage

> SendTextMessage201Response SendTextMessage(ctx).SendTextMessageRequest(sendTextMessageRequest).Execute()

Send text message



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	sendTextMessageRequest := *openapiclient.NewSendTextMessageRequest("InstanceId_example", "To_example", "Text_example") // SendTextMessageRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MessagesAPI.SendTextMessage(context.Background()).SendTextMessageRequest(sendTextMessageRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MessagesAPI.SendTextMessage``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendTextMessage`: SendTextMessage201Response
	fmt.Fprintf(os.Stdout, "Response from `MessagesAPI.SendTextMessage`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSendTextMessageRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **sendTextMessageRequest** | [**SendTextMessageRequest**](SendTextMessageRequest.md) |  | 

### Return type

[**SendTextMessage201Response**](SendTextMessage201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

