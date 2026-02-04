# \LogsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**GetRecentLogs**](LogsAPI.md#GetRecentLogs) | **Get** /logs/recent | Get recent logs
[**StreamLogs**](LogsAPI.md#StreamLogs) | **Get** /logs/stream | Stream logs (SSE)



## GetRecentLogs

> GetRecentLogs200Response GetRecentLogs(ctx).Modules(modules).Level(level).Limit(limit).Execute()

Get recent logs



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
	modules := "modules_example" // string |  (optional)
	level := "level_example" // string |  (optional) (default to "info")
	limit := int32(56) // int32 |  (optional) (default to 100)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.LogsAPI.GetRecentLogs(context.Background()).Modules(modules).Level(level).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `LogsAPI.GetRecentLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetRecentLogs`: GetRecentLogs200Response
	fmt.Fprintf(os.Stdout, "Response from `LogsAPI.GetRecentLogs`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiGetRecentLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **modules** | **string** |  | 
 **level** | **string** |  | [default to &quot;info&quot;]
 **limit** | **int32** |  | [default to 100]

### Return type

[**GetRecentLogs200Response**](GetRecentLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## StreamLogs

> string StreamLogs(ctx).Modules(modules).Level(level).Execute()

Stream logs (SSE)



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
	modules := "modules_example" // string |  (optional)
	level := "level_example" // string |  (optional) (default to "info")

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.LogsAPI.StreamLogs(context.Background()).Modules(modules).Level(level).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `LogsAPI.StreamLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `StreamLogs`: string
	fmt.Fprintf(os.Stdout, "Response from `LogsAPI.StreamLogs`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiStreamLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **modules** | **string** |  | 
 **level** | **string** |  | [default to &quot;info&quot;]

### Return type

**string**

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: text/event-stream

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

