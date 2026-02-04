# \ReadReceiptsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**MarkChatRead**](ReadReceiptsAPI.md#MarkChatRead) | **Post** /chats/{id}/read | Mark entire chat as read
[**MarkMessageRead**](ReadReceiptsAPI.md#MarkMessageRead) | **Post** /messages/{id}/read | Mark message as read
[**MarkMessagesRead**](ReadReceiptsAPI.md#MarkMessagesRead) | **Post** /messages/read | Mark multiple messages as read



## MarkChatRead

> MarkMessageRead200Response MarkChatRead(ctx, id).MarkMessageReadRequest(markMessageReadRequest).Execute()

Mark entire chat as read



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
	resp, r, err := apiClient.ReadReceiptsAPI.MarkChatRead(context.Background(), id).MarkMessageReadRequest(markMessageReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ReadReceiptsAPI.MarkChatRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkChatRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `ReadReceiptsAPI.MarkChatRead`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMarkChatReadRequest struct via the builder pattern


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
	resp, r, err := apiClient.ReadReceiptsAPI.MarkMessageRead(context.Background(), id).MarkMessageReadRequest(markMessageReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ReadReceiptsAPI.MarkMessageRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkMessageRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `ReadReceiptsAPI.MarkMessageRead`: %v\n", resp)
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
	resp, r, err := apiClient.ReadReceiptsAPI.MarkMessagesRead(context.Background()).MarkMessagesReadRequest(markMessagesReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ReadReceiptsAPI.MarkMessagesRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkMessagesRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `ReadReceiptsAPI.MarkMessagesRead`: %v\n", resp)
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

