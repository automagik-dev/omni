# \WebhooksAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CreateWebhookSource**](WebhooksAPI.md#CreateWebhookSource) | **Post** /webhook-sources | Create webhook source
[**DeleteWebhookSource**](WebhooksAPI.md#DeleteWebhookSource) | **Delete** /webhook-sources/{id} | Delete webhook source
[**GetWebhookSource**](WebhooksAPI.md#GetWebhookSource) | **Get** /webhook-sources/{id} | Get webhook source
[**ListWebhookSources**](WebhooksAPI.md#ListWebhookSources) | **Get** /webhook-sources | List webhook sources
[**ReceiveWebhook**](WebhooksAPI.md#ReceiveWebhook) | **Post** /webhooks/{source} | Receive webhook
[**TriggerEvent**](WebhooksAPI.md#TriggerEvent) | **Post** /events/trigger | Trigger custom event
[**UpdateWebhookSource**](WebhooksAPI.md#UpdateWebhookSource) | **Patch** /webhook-sources/{id} | Update webhook source



## CreateWebhookSource

> CreateWebhookSource201Response CreateWebhookSource(ctx).CreateWebhookSourceRequest(createWebhookSourceRequest).Execute()

Create webhook source



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
	createWebhookSourceRequest := *openapiclient.NewCreateWebhookSourceRequest("Name_example") // CreateWebhookSourceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WebhooksAPI.CreateWebhookSource(context.Background()).CreateWebhookSourceRequest(createWebhookSourceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.CreateWebhookSource``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateWebhookSource`: CreateWebhookSource201Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.CreateWebhookSource`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateWebhookSourceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createWebhookSourceRequest** | [**CreateWebhookSourceRequest**](CreateWebhookSourceRequest.md) |  | 

### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteWebhookSource

> DeleteInstance200Response DeleteWebhookSource(ctx, id).Execute()

Delete webhook source



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
	resp, r, err := apiClient.WebhooksAPI.DeleteWebhookSource(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.DeleteWebhookSource``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteWebhookSource`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.DeleteWebhookSource`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteWebhookSourceRequest struct via the builder pattern


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


## GetWebhookSource

> CreateWebhookSource201Response GetWebhookSource(ctx, id).Execute()

Get webhook source



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
	resp, r, err := apiClient.WebhooksAPI.GetWebhookSource(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.GetWebhookSource``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetWebhookSource`: CreateWebhookSource201Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.GetWebhookSource`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetWebhookSourceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListWebhookSources

> ListWebhookSources200Response ListWebhookSources(ctx).Enabled(enabled).Execute()

List webhook sources



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
	enabled := true // bool |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WebhooksAPI.ListWebhookSources(context.Background()).Enabled(enabled).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.ListWebhookSources``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListWebhookSources`: ListWebhookSources200Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.ListWebhookSources`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListWebhookSourcesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **enabled** | **bool** |  | 

### Return type

[**ListWebhookSources200Response**](ListWebhookSources200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ReceiveWebhook

> ReceiveWebhook200Response ReceiveWebhook(ctx, source).RequestBody(requestBody).Execute()

Receive webhook



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
	source := "source_example" // string | 
	requestBody := map[string]interface{}{"key": interface{}(123)} // map[string]interface{} |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WebhooksAPI.ReceiveWebhook(context.Background(), source).RequestBody(requestBody).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.ReceiveWebhook``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ReceiveWebhook`: ReceiveWebhook200Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.ReceiveWebhook`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**source** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiReceiveWebhookRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **requestBody** | **map[string]interface{}** |  | 

### Return type

[**ReceiveWebhook200Response**](ReceiveWebhook200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## TriggerEvent

> ReceiveWebhook200Response TriggerEvent(ctx).TriggerEventRequest(triggerEventRequest).Execute()

Trigger custom event



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
	triggerEventRequest := *openapiclient.NewTriggerEventRequest("EventType_example", map[string]interface{}{"key": interface{}(123)}) // TriggerEventRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WebhooksAPI.TriggerEvent(context.Background()).TriggerEventRequest(triggerEventRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.TriggerEvent``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `TriggerEvent`: ReceiveWebhook200Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.TriggerEvent`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiTriggerEventRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **triggerEventRequest** | [**TriggerEventRequest**](TriggerEventRequest.md) |  | 

### Return type

[**ReceiveWebhook200Response**](ReceiveWebhook200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdateWebhookSource

> CreateWebhookSource201Response UpdateWebhookSource(ctx, id).UpdateWebhookSourceRequest(updateWebhookSourceRequest).Execute()

Update webhook source



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
	updateWebhookSourceRequest := *openapiclient.NewUpdateWebhookSourceRequest() // UpdateWebhookSourceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WebhooksAPI.UpdateWebhookSource(context.Background(), id).UpdateWebhookSourceRequest(updateWebhookSourceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WebhooksAPI.UpdateWebhookSource``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdateWebhookSource`: CreateWebhookSource201Response
	fmt.Fprintf(os.Stdout, "Response from `WebhooksAPI.UpdateWebhookSource`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdateWebhookSourceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updateWebhookSourceRequest** | [**UpdateWebhookSourceRequest**](UpdateWebhookSourceRequest.md) |  | 

### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

