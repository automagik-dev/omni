# \InstancesAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ConnectInstance**](InstancesAPI.md#ConnectInstance) | **Post** /instances/{id}/connect | Connect instance
[**CreateInstance**](InstancesAPI.md#CreateInstance) | **Post** /instances | Create new instance
[**DeleteInstance**](InstancesAPI.md#DeleteInstance) | **Delete** /instances/{id} | Delete instance
[**DisconnectInstance**](InstancesAPI.md#DisconnectInstance) | **Post** /instances/{id}/disconnect | Disconnect instance
[**GetInstance**](InstancesAPI.md#GetInstance) | **Get** /instances/{id} | Get instance by ID
[**GetInstanceQr**](InstancesAPI.md#GetInstanceQr) | **Get** /instances/{id}/qr | Get QR code for WhatsApp connection
[**GetInstanceStatus**](InstancesAPI.md#GetInstanceStatus) | **Get** /instances/{id}/status | Get instance connection status
[**GetUserProfile**](InstancesAPI.md#GetUserProfile) | **Get** /instances/{id}/users/{userId}/profile | Fetch user profile
[**ListInstanceContacts**](InstancesAPI.md#ListInstanceContacts) | **Get** /instances/{id}/contacts | List contacts
[**ListInstanceGroups**](InstancesAPI.md#ListInstanceGroups) | **Get** /instances/{id}/groups | List groups
[**ListInstances**](InstancesAPI.md#ListInstances) | **Get** /instances | List all instances
[**ListSupportedChannels**](InstancesAPI.md#ListSupportedChannels) | **Get** /instances/supported-channels | List supported channel types
[**LogoutInstance**](InstancesAPI.md#LogoutInstance) | **Post** /instances/{id}/logout | Logout instance
[**RequestPairingCode**](InstancesAPI.md#RequestPairingCode) | **Post** /instances/{id}/pair | Request pairing code
[**RestartInstance**](InstancesAPI.md#RestartInstance) | **Post** /instances/{id}/restart | Restart instance
[**UpdateInstance**](InstancesAPI.md#UpdateInstance) | **Patch** /instances/{id} | Update instance



## ConnectInstance

> ConnectInstance200Response ConnectInstance(ctx, id).ForceNewQr(forceNewQr).ConnectInstanceRequest(connectInstanceRequest).Execute()

Connect instance



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
	forceNewQr := "forceNewQr_example" // string |  (optional)
	connectInstanceRequest := *openapiclient.NewConnectInstanceRequest() // ConnectInstanceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.ConnectInstance(context.Background(), id).ForceNewQr(forceNewQr).ConnectInstanceRequest(connectInstanceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.ConnectInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConnectInstance`: ConnectInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.ConnectInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConnectInstanceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **forceNewQr** | **string** |  | 
 **connectInstanceRequest** | [**ConnectInstanceRequest**](ConnectInstanceRequest.md) |  | 

### Return type

[**ConnectInstance200Response**](ConnectInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## CreateInstance

> CreateInstance201Response CreateInstance(ctx).CreateInstanceRequest(createInstanceRequest).Execute()

Create new instance



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
	createInstanceRequest := *openapiclient.NewCreateInstanceRequest("Name_example", "Channel_example") // CreateInstanceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.CreateInstance(context.Background()).CreateInstanceRequest(createInstanceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.CreateInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateInstance`: CreateInstance201Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.CreateInstance`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateInstanceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createInstanceRequest** | [**CreateInstanceRequest**](CreateInstanceRequest.md) |  | 

### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteInstance

> DeleteInstance200Response DeleteInstance(ctx, id).Execute()

Delete instance



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
	resp, r, err := apiClient.InstancesAPI.DeleteInstance(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.DeleteInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteInstance`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.DeleteInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteInstanceRequest struct via the builder pattern


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


## DisconnectInstance

> DeleteInstance200Response DisconnectInstance(ctx, id).Execute()

Disconnect instance



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
	resp, r, err := apiClient.InstancesAPI.DisconnectInstance(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.DisconnectInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DisconnectInstance`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.DisconnectInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDisconnectInstanceRequest struct via the builder pattern


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


## GetInstance

> CreateInstance201Response GetInstance(ctx, id).Execute()

Get instance by ID



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
	resp, r, err := apiClient.InstancesAPI.GetInstance(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.GetInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetInstance`: CreateInstance201Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.GetInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetInstanceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetInstanceQr

> GetInstanceQr200Response GetInstanceQr(ctx, id).Execute()

Get QR code for WhatsApp connection



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
	resp, r, err := apiClient.InstancesAPI.GetInstanceQr(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.GetInstanceQr``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetInstanceQr`: GetInstanceQr200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.GetInstanceQr`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetInstanceQrRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetInstanceQr200Response**](GetInstanceQr200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetInstanceStatus

> GetInstanceStatus200Response GetInstanceStatus(ctx, id).Execute()

Get instance connection status



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
	resp, r, err := apiClient.InstancesAPI.GetInstanceStatus(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.GetInstanceStatus``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetInstanceStatus`: GetInstanceStatus200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.GetInstanceStatus`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetInstanceStatusRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetInstanceStatus200Response**](GetInstanceStatus200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetUserProfile

> GetUserProfile200Response GetUserProfile(ctx, id, userId).Execute()

Fetch user profile



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
	userId := "userId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.GetUserProfile(context.Background(), id, userId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.GetUserProfile``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetUserProfile`: GetUserProfile200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.GetUserProfile`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 
**userId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetUserProfileRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

[**GetUserProfile200Response**](GetUserProfile200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListInstanceContacts

> ListInstanceContacts200Response ListInstanceContacts(ctx, id).Limit(limit).Cursor(cursor).GuildId(guildId).Execute()

List contacts



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
	limit := int32(56) // int32 |  (optional) (default to 100)
	cursor := "cursor_example" // string |  (optional)
	guildId := "guildId_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.ListInstanceContacts(context.Background(), id).Limit(limit).Cursor(cursor).GuildId(guildId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.ListInstanceContacts``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListInstanceContacts`: ListInstanceContacts200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.ListInstanceContacts`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiListInstanceContactsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **limit** | **int32** |  | [default to 100]
 **cursor** | **string** |  | 
 **guildId** | **string** |  | 

### Return type

[**ListInstanceContacts200Response**](ListInstanceContacts200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListInstanceGroups

> ListInstanceGroups200Response ListInstanceGroups(ctx, id).Limit(limit).Cursor(cursor).Execute()

List groups



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
	limit := int32(56) // int32 |  (optional) (default to 100)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.ListInstanceGroups(context.Background(), id).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.ListInstanceGroups``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListInstanceGroups`: ListInstanceGroups200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.ListInstanceGroups`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiListInstanceGroupsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **limit** | **int32** |  | [default to 100]
 **cursor** | **string** |  | 

### Return type

[**ListInstanceGroups200Response**](ListInstanceGroups200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListInstances

> ListInstances200Response ListInstances(ctx).Channel(channel).Status(status).Limit(limit).Cursor(cursor).Execute()

List all instances



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
	channel := "channel_example" // string |  (optional)
	status := "status_example" // string |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.ListInstances(context.Background()).Channel(channel).Status(status).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.ListInstances``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListInstances`: ListInstances200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.ListInstances`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListInstancesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **channel** | **string** |  | 
 **status** | **string** |  | 
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**ListInstances200Response**](ListInstances200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListSupportedChannels

> ListSupportedChannels200Response ListSupportedChannels(ctx).Execute()

List supported channel types



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
	resp, r, err := apiClient.InstancesAPI.ListSupportedChannels(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.ListSupportedChannels``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListSupportedChannels`: ListSupportedChannels200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.ListSupportedChannels`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiListSupportedChannelsRequest struct via the builder pattern


### Return type

[**ListSupportedChannels200Response**](ListSupportedChannels200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## LogoutInstance

> DeleteInstance200Response LogoutInstance(ctx, id).Execute()

Logout instance



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
	resp, r, err := apiClient.InstancesAPI.LogoutInstance(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.LogoutInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `LogoutInstance`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.LogoutInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiLogoutInstanceRequest struct via the builder pattern


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


## RequestPairingCode

> RequestPairingCode200Response RequestPairingCode(ctx, id).RequestPairingCodeRequest(requestPairingCodeRequest).Execute()

Request pairing code



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
	requestPairingCodeRequest := *openapiclient.NewRequestPairingCodeRequest("PhoneNumber_example") // RequestPairingCodeRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.RequestPairingCode(context.Background(), id).RequestPairingCodeRequest(requestPairingCodeRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.RequestPairingCode``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RequestPairingCode`: RequestPairingCode200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.RequestPairingCode`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRequestPairingCodeRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **requestPairingCodeRequest** | [**RequestPairingCodeRequest**](RequestPairingCodeRequest.md) |  | 

### Return type

[**RequestPairingCode200Response**](RequestPairingCode200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RestartInstance

> ConnectInstance200Response RestartInstance(ctx, id).ForceNewQr(forceNewQr).Execute()

Restart instance



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
	forceNewQr := "forceNewQr_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.RestartInstance(context.Background(), id).ForceNewQr(forceNewQr).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.RestartInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RestartInstance`: ConnectInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.RestartInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRestartInstanceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **forceNewQr** | **string** |  | 

### Return type

[**ConnectInstance200Response**](ConnectInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdateInstance

> CreateInstance201Response UpdateInstance(ctx, id).UpdateInstanceRequest(updateInstanceRequest).Execute()

Update instance



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
	updateInstanceRequest := *openapiclient.NewUpdateInstanceRequest() // UpdateInstanceRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.InstancesAPI.UpdateInstance(context.Background(), id).UpdateInstanceRequest(updateInstanceRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `InstancesAPI.UpdateInstance``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdateInstance`: CreateInstance201Response
	fmt.Fprintf(os.Stdout, "Response from `InstancesAPI.UpdateInstance`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdateInstanceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updateInstanceRequest** | [**UpdateInstanceRequest**](UpdateInstanceRequest.md) |  | 

### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

