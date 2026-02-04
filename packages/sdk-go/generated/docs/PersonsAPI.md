# \PersonsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**GetPerson**](PersonsAPI.md#GetPerson) | **Get** /persons/{id} | Get person by ID
[**GetPersonPresence**](PersonsAPI.md#GetPersonPresence) | **Get** /persons/{id}/presence | Get person presence
[**GetPersonTimelineById**](PersonsAPI.md#GetPersonTimelineById) | **Get** /persons/{id}/timeline | Get person timeline
[**LinkIdentities**](PersonsAPI.md#LinkIdentities) | **Post** /persons/link | Link identities
[**MergePersons**](PersonsAPI.md#MergePersons) | **Post** /persons/merge | Merge persons
[**SearchPersons**](PersonsAPI.md#SearchPersons) | **Get** /persons | Search persons
[**UnlinkIdentity**](PersonsAPI.md#UnlinkIdentity) | **Post** /persons/unlink | Unlink identity



## GetPerson

> GetPerson200Response GetPerson(ctx, id).Execute()

Get person by ID



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
	resp, r, err := apiClient.PersonsAPI.GetPerson(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.GetPerson``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetPerson`: GetPerson200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.GetPerson`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetPersonRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetPerson200Response**](GetPerson200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetPersonPresence

> GetPersonPresence200Response GetPersonPresence(ctx, id).Execute()

Get person presence



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
	resp, r, err := apiClient.PersonsAPI.GetPersonPresence(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.GetPersonPresence``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetPersonPresence`: GetPersonPresence200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.GetPersonPresence`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetPersonPresenceRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**GetPersonPresence200Response**](GetPersonPresence200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetPersonTimelineById

> GetPersonTimelineById200Response GetPersonTimelineById(ctx, id).Channels(channels).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()

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
	id := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	channels := "channels_example" // string |  (optional)
	since := time.Now() // time.Time |  (optional)
	until := time.Now() // time.Time |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)
	cursor := "cursor_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PersonsAPI.GetPersonTimelineById(context.Background(), id).Channels(channels).Since(since).Until(until).Limit(limit).Cursor(cursor).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.GetPersonTimelineById``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetPersonTimelineById`: GetPersonTimelineById200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.GetPersonTimelineById`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetPersonTimelineByIdRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **channels** | **string** |  | 
 **since** | **time.Time** |  | 
 **until** | **time.Time** |  | 
 **limit** | **int32** |  | [default to 50]
 **cursor** | **string** |  | 

### Return type

[**GetPersonTimelineById200Response**](GetPersonTimelineById200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## LinkIdentities

> GetPerson200Response LinkIdentities(ctx).LinkIdentitiesRequest(linkIdentitiesRequest).Execute()

Link identities



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
	linkIdentitiesRequest := *openapiclient.NewLinkIdentitiesRequest("IdentityA_example", "IdentityB_example") // LinkIdentitiesRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PersonsAPI.LinkIdentities(context.Background()).LinkIdentitiesRequest(linkIdentitiesRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.LinkIdentities``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `LinkIdentities`: GetPerson200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.LinkIdentities`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiLinkIdentitiesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **linkIdentitiesRequest** | [**LinkIdentitiesRequest**](LinkIdentitiesRequest.md) |  | 

### Return type

[**GetPerson200Response**](GetPerson200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## MergePersons

> MergePersons200Response MergePersons(ctx).MergePersonsRequest(mergePersonsRequest).Execute()

Merge persons



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
	mergePersonsRequest := *openapiclient.NewMergePersonsRequest("SourcePersonId_example", "TargetPersonId_example") // MergePersonsRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PersonsAPI.MergePersons(context.Background()).MergePersonsRequest(mergePersonsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.MergePersons``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MergePersons`: MergePersons200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.MergePersons`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiMergePersonsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **mergePersonsRequest** | [**MergePersonsRequest**](MergePersonsRequest.md) |  | 

### Return type

[**MergePersons200Response**](MergePersons200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SearchPersons

> SearchPersons200Response SearchPersons(ctx).Search(search).Limit(limit).Execute()

Search persons



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
	search := "search_example" // string | 
	limit := int32(56) // int32 |  (optional) (default to 20)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PersonsAPI.SearchPersons(context.Background()).Search(search).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.SearchPersons``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SearchPersons`: SearchPersons200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.SearchPersons`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiSearchPersonsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **search** | **string** |  | 
 **limit** | **int32** |  | [default to 20]

### Return type

[**SearchPersons200Response**](SearchPersons200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UnlinkIdentity

> UnlinkIdentity200Response UnlinkIdentity(ctx).UnlinkIdentityRequest(unlinkIdentityRequest).Execute()

Unlink identity



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
	unlinkIdentityRequest := *openapiclient.NewUnlinkIdentityRequest("IdentityId_example", "Reason_example") // UnlinkIdentityRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.PersonsAPI.UnlinkIdentity(context.Background()).UnlinkIdentityRequest(unlinkIdentityRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `PersonsAPI.UnlinkIdentity``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UnlinkIdentity`: UnlinkIdentity200Response
	fmt.Fprintf(os.Stdout, "Response from `PersonsAPI.UnlinkIdentity`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiUnlinkIdentityRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **unlinkIdentityRequest** | [**UnlinkIdentityRequest**](UnlinkIdentityRequest.md) |  | 

### Return type

[**UnlinkIdentity200Response**](UnlinkIdentity200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

