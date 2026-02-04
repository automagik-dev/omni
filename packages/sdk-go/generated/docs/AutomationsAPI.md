# \AutomationsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CreateAutomation**](AutomationsAPI.md#CreateAutomation) | **Post** /automations | Create automation
[**DeleteAutomation**](AutomationsAPI.md#DeleteAutomation) | **Delete** /automations/{id} | Delete automation
[**DisableAutomation**](AutomationsAPI.md#DisableAutomation) | **Post** /automations/{id}/disable | Disable automation
[**EnableAutomation**](AutomationsAPI.md#EnableAutomation) | **Post** /automations/{id}/enable | Enable automation
[**ExecuteAutomation**](AutomationsAPI.md#ExecuteAutomation) | **Post** /automations/{id}/execute | Execute automation
[**GetAutomation**](AutomationsAPI.md#GetAutomation) | **Get** /automations/{id} | Get automation
[**GetAutomationLogs**](AutomationsAPI.md#GetAutomationLogs) | **Get** /automations/{id}/logs | Get automation logs
[**GetAutomationMetrics**](AutomationsAPI.md#GetAutomationMetrics) | **Get** /automation-metrics | Get automation metrics
[**ListAutomations**](AutomationsAPI.md#ListAutomations) | **Get** /automations | List automations
[**SearchAutomationLogs**](AutomationsAPI.md#SearchAutomationLogs) | **Get** /automation-logs | Search automation logs
[**TestAutomation**](AutomationsAPI.md#TestAutomation) | **Post** /automations/{id}/test | Test automation
[**UpdateAutomation**](AutomationsAPI.md#UpdateAutomation) | **Patch** /automations/{id} | Update automation



## CreateAutomation

> CreateAutomation201Response CreateAutomation(ctx).CreateAutomationRequest(createAutomationRequest).Execute()

Create automation



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
	createAutomationRequest := *openapiclient.NewCreateAutomationRequest("Name_example", "TriggerEventType_example", []openapiclient.ListAutomations200ResponseItemsInnerActionsInner{*openapiclient.NewListAutomations200ResponseItemsInnerActionsInner("Type_example", *openapiclient.NewListAutomations200ResponseItemsInnerActionsInnerAnyOf4Config("AgentId_example"))}) // CreateAutomationRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.CreateAutomation(context.Background()).CreateAutomationRequest(createAutomationRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.CreateAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateAutomation`: CreateAutomation201Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.CreateAutomation`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createAutomationRequest** | [**CreateAutomationRequest**](CreateAutomationRequest.md) |  | 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteAutomation

> DeleteInstance200Response DeleteAutomation(ctx, id).Execute()

Delete automation



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
	resp, r, err := apiClient.AutomationsAPI.DeleteAutomation(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.DeleteAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteAutomation`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.DeleteAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteAutomationRequest struct via the builder pattern


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


## DisableAutomation

> CreateAutomation201Response DisableAutomation(ctx, id).Execute()

Disable automation



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
	resp, r, err := apiClient.AutomationsAPI.DisableAutomation(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.DisableAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DisableAutomation`: CreateAutomation201Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.DisableAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDisableAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## EnableAutomation

> CreateAutomation201Response EnableAutomation(ctx, id).Execute()

Enable automation



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
	resp, r, err := apiClient.AutomationsAPI.EnableAutomation(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.EnableAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EnableAutomation`: CreateAutomation201Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.EnableAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEnableAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecuteAutomation

> ExecuteAutomation200Response ExecuteAutomation(ctx, id).TestAutomationRequest(testAutomationRequest).Execute()

Execute automation



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
	testAutomationRequest := *openapiclient.NewTestAutomationRequest(*openapiclient.NewTestAutomationRequestEvent("Type_example", map[string]interface{}{"key": interface{}(123)})) // TestAutomationRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.ExecuteAutomation(context.Background(), id).TestAutomationRequest(testAutomationRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.ExecuteAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecuteAutomation`: ExecuteAutomation200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.ExecuteAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecuteAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **testAutomationRequest** | [**TestAutomationRequest**](TestAutomationRequest.md) |  | 

### Return type

[**ExecuteAutomation200Response**](ExecuteAutomation200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetAutomation

> CreateAutomation201Response GetAutomation(ctx, id).Execute()

Get automation



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
	resp, r, err := apiClient.AutomationsAPI.GetAutomation(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.GetAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetAutomation`: CreateAutomation201Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.GetAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetAutomationLogs

> GetAutomationLogs200Response GetAutomationLogs(ctx, id).Limit(limit).Cursor(cursor).Execute()

Get automation logs



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
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.GetAutomationLogs(context.Background(), id).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.GetAutomationLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetAutomationLogs`: GetAutomationLogs200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.GetAutomationLogs`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetAutomationLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**GetAutomationLogs200Response**](GetAutomationLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetAutomationMetrics

> GetAutomationMetrics200Response GetAutomationMetrics(ctx).Execute()

Get automation metrics



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
	resp, r, err := apiClient.AutomationsAPI.GetAutomationMetrics(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.GetAutomationMetrics``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetAutomationMetrics`: GetAutomationMetrics200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.GetAutomationMetrics`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGetAutomationMetricsRequest struct via the builder pattern


### Return type

[**GetAutomationMetrics200Response**](GetAutomationMetrics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListAutomations

> ListAutomations200Response ListAutomations(ctx).Enabled(enabled).Execute()

List automations



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
	resp, r, err := apiClient.AutomationsAPI.ListAutomations(context.Background()).Enabled(enabled).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.ListAutomations``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListAutomations`: ListAutomations200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.ListAutomations`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListAutomationsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **enabled** | **bool** |  | 

### Return type

[**ListAutomations200Response**](ListAutomations200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SearchAutomationLogs

> GetAutomationLogs200Response SearchAutomationLogs(ctx).Limit(limit).Cursor(cursor).Status(status).EventType(eventType).AutomationId(automationId).Execute()

Search automation logs



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
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)
	status := "status_example" // string |  (optional)
	eventType := "eventType_example" // string |  (optional)
	automationId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.SearchAutomationLogs(context.Background()).Limit(limit).Cursor(cursor).Status(status).EventType(eventType).AutomationId(automationId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.SearchAutomationLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SearchAutomationLogs`: GetAutomationLogs200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.SearchAutomationLogs`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSearchAutomationLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 
 **status** | **string** |  | 
 **eventType** | **string** |  | 
 **automationId** | **string** |  | 

### Return type

[**GetAutomationLogs200Response**](GetAutomationLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## TestAutomation

> TestAutomation200Response TestAutomation(ctx, id).TestAutomationRequest(testAutomationRequest).Execute()

Test automation



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
	testAutomationRequest := *openapiclient.NewTestAutomationRequest(*openapiclient.NewTestAutomationRequestEvent("Type_example", map[string]interface{}{"key": interface{}(123)})) // TestAutomationRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.TestAutomation(context.Background(), id).TestAutomationRequest(testAutomationRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.TestAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `TestAutomation`: TestAutomation200Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.TestAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiTestAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **testAutomationRequest** | [**TestAutomationRequest**](TestAutomationRequest.md) |  | 

### Return type

[**TestAutomation200Response**](TestAutomation200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdateAutomation

> CreateAutomation201Response UpdateAutomation(ctx, id).UpdateAutomationRequest(updateAutomationRequest).Execute()

Update automation



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
	updateAutomationRequest := *openapiclient.NewUpdateAutomationRequest() // UpdateAutomationRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AutomationsAPI.UpdateAutomation(context.Background(), id).UpdateAutomationRequest(updateAutomationRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AutomationsAPI.UpdateAutomation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdateAutomation`: CreateAutomation201Response
	fmt.Fprintf(os.Stdout, "Response from `AutomationsAPI.UpdateAutomation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdateAutomationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updateAutomationRequest** | [**UpdateAutomationRequest**](UpdateAutomationRequest.md) |  | 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

