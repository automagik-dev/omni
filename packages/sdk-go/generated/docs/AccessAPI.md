# \AccessAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CheckAccess**](AccessAPI.md#CheckAccess) | **Post** /access/check | Check access
[**CreateAccessRule**](AccessAPI.md#CreateAccessRule) | **Post** /access/rules | Create access rule
[**DeleteAccessRule**](AccessAPI.md#DeleteAccessRule) | **Delete** /access/rules/{id} | Delete access rule
[**GetAccessRule**](AccessAPI.md#GetAccessRule) | **Get** /access/rules/{id} | Get access rule
[**ListAccessRules**](AccessAPI.md#ListAccessRules) | **Get** /access/rules | List access rules
[**UpdateAccessRule**](AccessAPI.md#UpdateAccessRule) | **Patch** /access/rules/{id} | Update access rule



## CheckAccess

> CheckAccess200Response CheckAccess(ctx).CheckAccessRequest(checkAccessRequest).Execute()

Check access



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
	checkAccessRequest := *openapiclient.NewCheckAccessRequest("InstanceId_example", "PlatformUserId_example", "Channel_example") // CheckAccessRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AccessAPI.CheckAccess(context.Background()).CheckAccessRequest(checkAccessRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.CheckAccess``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CheckAccess`: CheckAccess200Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.CheckAccess`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCheckAccessRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **checkAccessRequest** | [**CheckAccessRequest**](CheckAccessRequest.md) |  | 

### Return type

[**CheckAccess200Response**](CheckAccess200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## CreateAccessRule

> CreateAccessRule201Response CreateAccessRule(ctx).CreateAccessRuleRequest(createAccessRuleRequest).Execute()

Create access rule



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
	createAccessRuleRequest := *openapiclient.NewCreateAccessRuleRequest("RuleType_example") // CreateAccessRuleRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AccessAPI.CreateAccessRule(context.Background()).CreateAccessRuleRequest(createAccessRuleRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.CreateAccessRule``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `CreateAccessRule`: CreateAccessRule201Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.CreateAccessRule`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiCreateAccessRuleRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **createAccessRuleRequest** | [**CreateAccessRuleRequest**](CreateAccessRuleRequest.md) |  | 

### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteAccessRule

> DeleteInstance200Response DeleteAccessRule(ctx, id).Execute()

Delete access rule



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
	resp, r, err := apiClient.AccessAPI.DeleteAccessRule(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.DeleteAccessRule``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteAccessRule`: DeleteInstance200Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.DeleteAccessRule`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteAccessRuleRequest struct via the builder pattern


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


## GetAccessRule

> CreateAccessRule201Response GetAccessRule(ctx, id).Execute()

Get access rule



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
	resp, r, err := apiClient.AccessAPI.GetAccessRule(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.GetAccessRule``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetAccessRule`: CreateAccessRule201Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.GetAccessRule`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetAccessRuleRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListAccessRules

> ListAccessRules200Response ListAccessRules(ctx).InstanceId(instanceId).Type_(type_).Execute()

List access rules



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
	instanceId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	type_ := "type__example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AccessAPI.ListAccessRules(context.Background()).InstanceId(instanceId).Type_(type_).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.ListAccessRules``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListAccessRules`: ListAccessRules200Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.ListAccessRules`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListAccessRulesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **instanceId** | **string** |  | 
 **type_** | **string** |  | 

### Return type

[**ListAccessRules200Response**](ListAccessRules200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UpdateAccessRule

> CreateAccessRule201Response UpdateAccessRule(ctx, id).UpdateAccessRuleRequest(updateAccessRuleRequest).Execute()

Update access rule



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
	updateAccessRuleRequest := *openapiclient.NewUpdateAccessRuleRequest() // UpdateAccessRuleRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AccessAPI.UpdateAccessRule(context.Background(), id).UpdateAccessRuleRequest(updateAccessRuleRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AccessAPI.UpdateAccessRule``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UpdateAccessRule`: CreateAccessRule201Response
	fmt.Fprintf(os.Stdout, "Response from `AccessAPI.UpdateAccessRule`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUpdateAccessRuleRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **updateAccessRuleRequest** | [**UpdateAccessRuleRequest**](UpdateAccessRuleRequest.md) |  | 

### Return type

[**CreateAccessRule201Response**](CreateAccessRule201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

