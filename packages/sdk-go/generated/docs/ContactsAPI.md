# \ContactsAPI

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ListInstanceContacts**](ContactsAPI.md#ListInstanceContacts) | **Get** /instances/{id}/contacts | List contacts



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
	resp, r, err := apiClient.ContactsAPI.ListInstanceContacts(context.Background(), id).Limit(limit).Cursor(cursor).GuildId(guildId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ContactsAPI.ListInstanceContacts``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListInstanceContacts`: ListInstanceContacts200Response
	fmt.Fprintf(os.Stdout, "Response from `ContactsAPI.ListInstanceContacts`: %v\n", resp)
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

