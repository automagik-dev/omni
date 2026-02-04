# \DeadLettersAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**AbandonDeadLetter**](DeadLettersAPI.md#AbandonDeadLetter) | **Post** /dead-letters/{id}/abandon | Abandon dead letter
[**GetDeadLetter**](DeadLettersAPI.md#GetDeadLetter) | **Get** /dead-letters/{id} | Get dead letter
[**GetDeadLetterStats**](DeadLettersAPI.md#GetDeadLetterStats) | **Get** /dead-letters/stats | Get dead letter stats
[**ListDeadLetters**](DeadLettersAPI.md#ListDeadLetters) | **Get** /dead-letters | List dead letters
[**ResolveDeadLetter**](DeadLettersAPI.md#ResolveDeadLetter) | **Post** /dead-letters/{id}/resolve | Resolve dead letter
[**RetryDeadLetter**](DeadLettersAPI.md#RetryDeadLetter) | **Post** /dead-letters/{id}/retry | Retry dead letter



## AbandonDeadLetter

> GetDeadLetter200Response AbandonDeadLetter(ctx, id).Execute()

Abandon dead letter



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DeadLettersAPI.AbandonDeadLetter(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.AbandonDeadLetter``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AbandonDeadLetter`: GetDeadLetter200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.AbandonDeadLetter`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiAbandonDeadLetterRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetDeadLetter

> GetDeadLetter200Response GetDeadLetter(ctx, id).Execute()

Get dead letter



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DeadLettersAPI.GetDeadLetter(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.GetDeadLetter``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetDeadLetter`: GetDeadLetter200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.GetDeadLetter`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetDeadLetterRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetDeadLetterStats

> GetDeadLetterStats200Response GetDeadLetterStats(ctx).Execute()

Get dead letter stats



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
	resp, r, err := apiClient.DeadLettersAPI.GetDeadLetterStats(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.GetDeadLetterStats``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetDeadLetterStats`: GetDeadLetterStats200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.GetDeadLetterStats`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGetDeadLetterStatsRequest struct via the builder pattern


### Return type

[**GetDeadLetterStats200Response**](GetDeadLetterStats200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListDeadLetters

> ListDeadLetters200Response ListDeadLetters(ctx).Status(status).EventType(eventType).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()

List dead letters



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
    "time"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID/omni"
)

func main() {
	status := "status_example" // string |  (optional)
	eventType := "eventType_example" // string |  (optional)
	since := time.Now() // time.Time |  (optional)
	until := time.Now() // time.Time |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DeadLettersAPI.ListDeadLetters(context.Background()).Status(status).EventType(eventType).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.ListDeadLetters``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListDeadLetters`: ListDeadLetters200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.ListDeadLetters`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListDeadLettersRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **status** | **string** |  | 
 **eventType** | **string** |  | 
 **since** | **time.Time** |  | 
 **until** | **time.Time** |  | 
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**ListDeadLetters200Response**](ListDeadLetters200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ResolveDeadLetter

> GetDeadLetter200Response ResolveDeadLetter(ctx, id).ResolveDeadLetterRequest(resolveDeadLetterRequest).Execute()

Resolve dead letter



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
	resolveDeadLetterRequest := *openapiclient.NewResolveDeadLetterRequest("Note_example") // ResolveDeadLetterRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DeadLettersAPI.ResolveDeadLetter(context.Background(), id).ResolveDeadLetterRequest(resolveDeadLetterRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.ResolveDeadLetter``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ResolveDeadLetter`: GetDeadLetter200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.ResolveDeadLetter`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiResolveDeadLetterRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **resolveDeadLetterRequest** | [**ResolveDeadLetterRequest**](ResolveDeadLetterRequest.md) |  | 

### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RetryDeadLetter

> RetryDeadLetter200Response RetryDeadLetter(ctx, id).Execute()

Retry dead letter



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DeadLettersAPI.RetryDeadLetter(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DeadLettersAPI.RetryDeadLetter``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RetryDeadLetter`: RetryDeadLetter200Response
	fmt.Fprintf(os.Stdout, "Response from `DeadLettersAPI.RetryDeadLetter`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRetryDeadLetterRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**RetryDeadLetter200Response**](RetryDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

