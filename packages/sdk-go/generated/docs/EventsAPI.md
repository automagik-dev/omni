# \EventsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CancelReplaySession**](EventsAPI.md#CancelReplaySession) | **Delete** /event-ops/replay/{id} | Cancel replay session
[**GetEvent**](EventsAPI.md#GetEvent) | **Get** /events/{id} | Get event by ID
[**GetEventAnalytics**](EventsAPI.md#GetEventAnalytics) | **Get** /events/analytics | Get event analytics
[**GetEventMetrics**](EventsAPI.md#GetEventMetrics) | **Get** /event-ops/metrics | Get event metrics
[**GetEventsBySender**](EventsAPI.md#GetEventsBySender) | **Get** /events/by-sender/{senderId} | Get events by sender
[**GetPersonTimeline**](EventsAPI.md#GetPersonTimeline) | **Get** /events/timeline/{personId} | Get person timeline
[**GetReplaySession**](EventsAPI.md#GetReplaySession) | **Get** /event-ops/replay/{id} | Get replay session
[**ListEvents**](EventsAPI.md#ListEvents) | **Get** /events | List events
[**ListReplaySessions**](EventsAPI.md#ListReplaySessions) | **Get** /event-ops/replay | List replay sessions
[**RunScheduledOps**](EventsAPI.md#RunScheduledOps) | **Post** /event-ops/scheduled | Run scheduled operations
[**SearchEvents**](EventsAPI.md#SearchEvents) | **Post** /events/search | Advanced event search
[**StartEventReplay**](EventsAPI.md#StartEventReplay) | **Post** /event-ops/replay | Start replay session



## CancelReplaySession

> DeleteInstance200Response CancelReplaySession(ctx, id).Execute()

Cancel replay session



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
	resp, r, err := apiClient.EventsAPI.CancelReplaySession(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.CancelReplaySession``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CancelReplaySession`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.CancelReplaySession`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiCancelReplaySessionRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**DeleteInstance200Response**](DeleteInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEvent

> GetEvent200Response GetEvent(ctx, id).Execute()

Get event by ID



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
	resp, r, err := apiClient.EventsAPI.GetEvent(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetEvent``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEvent`: GetEvent200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetEvent`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEventRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetEvent200Response**](GetEvent200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEventAnalytics

> GetEventAnalytics200Response GetEventAnalytics(ctx).Since(since).Until(until).InstanceId(instanceId).AllTime(allTime).Execute()

Get event analytics



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
	since := time.Now() // time.Time |  (optional)
	until := time.Now() // time.Time |  (optional)
	instanceId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	allTime := true // bool |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.GetEventAnalytics(context.Background()).Since(since).Until(until).InstanceId(instanceId).AllTime(allTime).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetEventAnalytics``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEventAnalytics`: GetEventAnalytics200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetEventAnalytics`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiGetEventAnalyticsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **since** | **time.Time** |  | 
 **until** | **time.Time** |  | 
 **instanceId** | **string** |  | 
 **allTime** | **bool** |  | 

### Return type

[**GetEventAnalytics200Response**](GetEventAnalytics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEventMetrics

> GetEventMetrics200Response GetEventMetrics(ctx).Execute()

Get event metrics



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
	resp, r, err := apiClient.EventsAPI.GetEventMetrics(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetEventMetrics``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEventMetrics`: GetEventMetrics200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetEventMetrics`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGetEventMetricsRequest struct via the builder pattern


### Return type

[**GetEventMetrics200Response**](GetEventMetrics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetEventsBySender

> GetEventsBySender200Response GetEventsBySender(ctx, senderId).InstanceId(instanceId).Limit(limit).Execute()

Get events by sender



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
	senderId := "senderId_example" // string | 
	instanceId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.GetEventsBySender(context.Background(), senderId).InstanceId(instanceId).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetEventsBySender``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetEventsBySender`: GetEventsBySender200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetEventsBySender`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**senderId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetEventsBySenderRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **instanceId** | **string** |  | 
 **limit** | **int32** |  | [default to 50]

### Return type

[**GetEventsBySender200Response**](GetEventsBySender200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetPersonTimeline

> GetPersonTimeline200Response GetPersonTimeline(ctx, personId).Channels(channels).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()

Get person timeline



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
	personId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	channels := "channels_example" // string |  (optional)
	since := time.Now() // time.Time |  (optional)
	until := time.Now() // time.Time |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.GetPersonTimeline(context.Background(), personId).Channels(channels).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetPersonTimeline``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetPersonTimeline`: GetPersonTimeline200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetPersonTimeline`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**personId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetPersonTimelineRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **channels** | **string** |  | 
 **since** | **time.Time** |  | 
 **until** | **time.Time** |  | 
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**GetPersonTimeline200Response**](GetPersonTimeline200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetReplaySession

> StartEventReplay202Response GetReplaySession(ctx, id).Execute()

Get replay session



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
	resp, r, err := apiClient.EventsAPI.GetReplaySession(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.GetReplaySession``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetReplaySession`: StartEventReplay202Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.GetReplaySession`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetReplaySessionRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**StartEventReplay202Response**](StartEventReplay202Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListEvents

> ListEvents200Response ListEvents(ctx).Channel(channel).InstanceId(instanceId).PersonId(personId).EventType(eventType).ContentType(contentType).Direction(direction).Since(since).Until(until).Search(search).Limit(limit).Cursor(cursor).Execute()

List events



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
	channel := "channel_example" // string |  (optional)
	instanceId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	personId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	eventType := "eventType_example" // string |  (optional)
	contentType := "contentType_example" // string |  (optional)
	direction := "direction_example" // string |  (optional)
	since := time.Now() // time.Time |  (optional)
	until := time.Now() // time.Time |  (optional)
	search := "search_example" // string |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.ListEvents(context.Background()).Channel(channel).InstanceId(instanceId).PersonId(personId).EventType(eventType).ContentType(contentType).Direction(direction).Since(since).Until(until).Search(search).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.ListEvents``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListEvents`: ListEvents200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.ListEvents`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListEventsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **channel** | **string** |  | 
 **instanceId** | **string** |  | 
 **personId** | **string** |  | 
 **eventType** | **string** |  | 
 **contentType** | **string** |  | 
 **direction** | **string** |  | 
 **since** | **time.Time** |  | 
 **until** | **time.Time** |  | 
 **search** | **string** |  | 
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**ListEvents200Response**](ListEvents200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListReplaySessions

> ListReplaySessions200Response ListReplaySessions(ctx).Execute()

List replay sessions



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
	resp, r, err := apiClient.EventsAPI.ListReplaySessions(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.ListReplaySessions``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListReplaySessions`: ListReplaySessions200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.ListReplaySessions`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiListReplaySessionsRequest struct via the builder pattern


### Return type

[**ListReplaySessions200Response**](ListReplaySessions200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RunScheduledOps

> RunScheduledOps200Response RunScheduledOps(ctx).Execute()

Run scheduled operations



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
	resp, r, err := apiClient.EventsAPI.RunScheduledOps(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.RunScheduledOps``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RunScheduledOps`: RunScheduledOps200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.RunScheduledOps`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiRunScheduledOpsRequest struct via the builder pattern


### Return type

[**RunScheduledOps200Response**](RunScheduledOps200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SearchEvents

> SearchEvents200Response SearchEvents(ctx).SearchEventsRequest(searchEventsRequest).Execute()

Advanced event search



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
	searchEventsRequest := *openapiclient.NewSearchEventsRequest() // SearchEventsRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.SearchEvents(context.Background()).SearchEventsRequest(searchEventsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.SearchEvents``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SearchEvents`: SearchEvents200Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.SearchEvents`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSearchEventsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **searchEventsRequest** | [**SearchEventsRequest**](SearchEventsRequest.md) |  | 

### Return type

[**SearchEvents200Response**](SearchEvents200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## StartEventReplay

> StartEventReplay202Response StartEventReplay(ctx).ListReplaySessions200ResponseItemsInnerOptions(listReplaySessions200ResponseItemsInnerOptions).Execute()

Start replay session



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
	listReplaySessions200ResponseItemsInnerOptions := *openapiclient.NewListReplaySessions200ResponseItemsInnerOptions(time.Now()) // ListReplaySessions200ResponseItemsInnerOptions |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.StartEventReplay(context.Background()).ListReplaySessions200ResponseItemsInnerOptions(listReplaySessions200ResponseItemsInnerOptions).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.StartEventReplay``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `StartEventReplay`: StartEventReplay202Response
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.StartEventReplay`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiStartEventReplayRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **listReplaySessions200ResponseItemsInnerOptions** | [**ListReplaySessions200ResponseItemsInnerOptions**](ListReplaySessions200ResponseItemsInnerOptions.md) |  | 

### Return type

[**StartEventReplay202Response**](StartEventReplay202Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

