# \PresenceAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**SendPresence**](PresenceAPI.md#SendPresence) | **Post** /messages/send/presence | Send presence indicator



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
	resp, r, err := apiClient.PresenceAPI.SendPresence(context.Background()).SendPresenceRequest(sendPresenceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PresenceAPI.SendPresence``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SendPresence`: SendPresence200Response
	fmt.Fprintf(os.Stdout, "Response from `PresenceAPI.SendPresence`: %v\n", resp)
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

