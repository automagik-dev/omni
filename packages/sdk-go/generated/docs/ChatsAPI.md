# \ChatsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**MarkChatRead**](ChatsAPI.md#MarkChatRead) | **Post** /chats/{id}/read | Mark entire chat as read



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
	resp, r, err := apiClient.ChatsAPI.MarkChatRead(context.Background(), id).MarkMessageReadRequest(markMessageReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ChatsAPI.MarkChatRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MarkChatRead`: MarkMessageRead200Response
	fmt.Fprintf(os.Stdout, "Response from `ChatsAPI.MarkChatRead`: %v\n", resp)
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

