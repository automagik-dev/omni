# \PayloadsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**DeleteEventPayloads**](PayloadsAPI.md#DeleteEventPayloads) | **Delete** /events/{eventId}/payloads | Delete event payloads
[**GetEventPayloadByStage**](PayloadsAPI.md#GetEventPayloadByStage) | **Get** /events/{eventId}/payloads/{stage} | Get event payload by stage
[**GetPayloadStats**](PayloadsAPI.md#GetPayloadStats) | **Get** /payload-stats | Get payload stats
[**ListEventPayloads**](PayloadsAPI.md#ListEventPayloads) | **Get** /events/{eventId}/payloads | List event payloads
[**ListPayloadConfigs**](PayloadsAPI.md#ListPayloadConfigs) | **Get** /payload-config | List payload configs
[**UpdatePayloadConfig**](PayloadsAPI.md#UpdatePayloadConfig) | **Put** /payload-config/{eventType} | Update payload config



## DeleteEventPayloads

> RunScheduledOps200ResponseDataPayloadCleanup DeleteEventPayloads(ctx, eventId).DeleteEventPayloadsRequest(deleteEventPayloadsRequest).Execute()

Delete event payloads



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
	eventId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	deleteEventPayloadsRequest := *openapiclient.NewDeleteEventPayloadsRequest("Reason_example") // DeleteEventPayloadsRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.DeleteEventPayloads(context.Background(), eventId).DeleteEventPayloadsRequest(deleteEventPayloadsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.DeleteEventPayloads``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteEventPayloads`: RunScheduledOps200ResponseDataPayloadCleanup
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.DeleteEventPayloads`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**eventId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteEventPayloadsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **deleteEventPayloadsRequest** | [**DeleteEventPayloadsRequest**](DeleteEventPayloadsRequest.md) |  | 

### Return type

[**RunScheduledOps200ResponseDataPayloadCleanup**](RunScheduledOps200ResponseDataPayloadCleanup.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEventPayloadByStage

> GetEventPayloadByStage200Response GetEventPayloadByStage(ctx, eventId, stage).Execute()

Get event payload by stage



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
	eventId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	stage := "stage_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.GetEventPayloadByStage(context.Background(), eventId, stage).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.GetEventPayloadByStage``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEventPayloadByStage`: GetEventPayloadByStage200Response
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.GetEventPayloadByStage`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**eventId** | **string** |  | 
**stage** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEventPayloadByStageRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

[**GetEventPayloadByStage200Response**](GetEventPayloadByStage200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetPayloadStats

> GetPayloadStats200Response GetPayloadStats(ctx).Execute()

Get payload stats



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.GetPayloadStats(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.GetPayloadStats``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetPayloadStats`: GetPayloadStats200Response
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.GetPayloadStats`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGetPayloadStatsRequest struct via the builder pattern


### Return type

[**GetPayloadStats200Response**](GetPayloadStats200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListEventPayloads

> ListEventPayloads200Response ListEventPayloads(ctx, eventId).Execute()

List event payloads



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
	eventId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.ListEventPayloads(context.Background(), eventId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.ListEventPayloads``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListEventPayloads`: ListEventPayloads200Response
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.ListEventPayloads`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**eventId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiListEventPayloadsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**ListEventPayloads200Response**](ListEventPayloads200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListPayloadConfigs

> ListPayloadConfigs200Response ListPayloadConfigs(ctx).Execute()

List payload configs



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.ListPayloadConfigs(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.ListPayloadConfigs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListPayloadConfigs`: ListPayloadConfigs200Response
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.ListPayloadConfigs`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiListPayloadConfigsRequest struct via the builder pattern


### Return type

[**ListPayloadConfigs200Response**](ListPayloadConfigs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdatePayloadConfig

> UpdatePayloadConfig200Response UpdatePayloadConfig(ctx, eventType).UpdatePayloadConfigRequest(updatePayloadConfigRequest).Execute()

Update payload config



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
	eventType := "eventType_example" // string | 
	updatePayloadConfigRequest := *openapiclient.NewUpdatePayloadConfigRequest() // UpdatePayloadConfigRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PayloadsAPI.UpdatePayloadConfig(context.Background(), eventType).UpdatePayloadConfigRequest(updatePayloadConfigRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PayloadsAPI.UpdatePayloadConfig``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdatePayloadConfig`: UpdatePayloadConfig200Response
	fmt.Fprintf(os.Stdout, "Response from `PayloadsAPI.UpdatePayloadConfig`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**eventType** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdatePayloadConfigRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updatePayloadConfigRequest** | [**UpdatePayloadConfigRequest**](UpdatePayloadConfigRequest.md) |  | 

### Return type

[**UpdatePayloadConfig200Response**](UpdatePayloadConfig200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

