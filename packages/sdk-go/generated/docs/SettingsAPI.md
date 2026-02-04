# \SettingsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**BulkUpdateSettings**](SettingsAPI.md#BulkUpdateSettings) | **Patch** /settings | Bulk update settings
[**DeleteSetting**](SettingsAPI.md#DeleteSetting) | **Delete** /settings/{key} | Delete setting
[**GetSetting**](SettingsAPI.md#GetSetting) | **Get** /settings/{key} | Get setting
[**GetSettingHistory**](SettingsAPI.md#GetSettingHistory) | **Get** /settings/{key}/history | Get setting history
[**ListSettings**](SettingsAPI.md#ListSettings) | **Get** /settings | List settings
[**SetSetting**](SettingsAPI.md#SetSetting) | **Put** /settings/{key} | Set setting



## BulkUpdateSettings

> ListSettings200Response BulkUpdateSettings(ctx).BulkUpdateSettingsRequest(bulkUpdateSettingsRequest).Execute()

Bulk update settings



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
	bulkUpdateSettingsRequest := *openapiclient.NewBulkUpdateSettingsRequest(map[string]interface{}{"key": interface{}(123)}) // BulkUpdateSettingsRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.BulkUpdateSettings(context.Background()).BulkUpdateSettingsRequest(bulkUpdateSettingsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.BulkUpdateSettings``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `BulkUpdateSettings`: ListSettings200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.BulkUpdateSettings`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiBulkUpdateSettingsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **bulkUpdateSettingsRequest** | [**BulkUpdateSettingsRequest**](BulkUpdateSettingsRequest.md) |  | 

### Return type

[**ListSettings200Response**](ListSettings200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteSetting

> DeleteInstance200Response DeleteSetting(ctx, key).Execute()

Delete setting



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
	key := "key_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.DeleteSetting(context.Background(), key).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.DeleteSetting``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteSetting`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.DeleteSetting`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**key** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteSettingRequest struct via the builder pattern


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


## GetSetting

> GetSetting200Response GetSetting(ctx, key).Execute()

Get setting



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
	key := "key_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.GetSetting(context.Background(), key).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.GetSetting``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetSetting`: GetSetting200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.GetSetting`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**key** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetSettingRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetSetting200Response**](GetSetting200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetSettingHistory

> GetSettingHistory200Response GetSettingHistory(ctx, key).Limit(limit).Since(since).Execute()

Get setting history



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
	key := "key_example" // string | 
	limit := int32(56) // int32 |  (optional) (default to 50)
	since := time.Now() // time.Time |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.GetSettingHistory(context.Background(), key).Limit(limit).Since(since).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.GetSettingHistory``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetSettingHistory`: GetSettingHistory200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.GetSettingHistory`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**key** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetSettingHistoryRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **limit** | **int32** |  | [default to 50]
 **since** | **time.Time** |  | 

### Return type

[**GetSettingHistory200Response**](GetSettingHistory200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListSettings

> ListSettings200Response ListSettings(ctx).Category(category).Execute()

List settings



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
	category := "category_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.ListSettings(context.Background()).Category(category).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.ListSettings``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListSettings`: ListSettings200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.ListSettings`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListSettingsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **category** | **string** |  | 

### Return type

[**ListSettings200Response**](ListSettings200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SetSetting

> GetSetting200Response SetSetting(ctx, key).SetSettingRequest(setSettingRequest).Execute()

Set setting



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
	key := "key_example" // string | 
	setSettingRequest := *openapiclient.NewSetSettingRequest() // SetSettingRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.SettingsAPI.SetSetting(context.Background(), key).SetSettingRequest(setSettingRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `SettingsAPI.SetSetting``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SetSetting`: GetSetting200Response
	fmt.Fprintf(os.Stdout, "Response from `SettingsAPI.SetSetting`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**key** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSetSettingRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **setSettingRequest** | [**SetSettingRequest**](SetSettingRequest.md) |  | 

### Return type

[**GetSetting200Response**](GetSetting200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

