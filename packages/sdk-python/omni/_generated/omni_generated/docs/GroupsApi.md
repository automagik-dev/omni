# omni_generated.GroupsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**list_instance_groups**](GroupsApi.md#list_instance_groups) | **GET** /instances/{id}/groups | List groups


# **list_instance_groups**
> ListInstanceGroups200Response list_instance_groups(id, limit=limit, cursor=cursor)

List groups

List groups the instance is participating in.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_instance_groups200_response import ListInstanceGroups200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.GroupsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    limit = 100 # int |  (optional) (default to 100)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # List groups
        api_response = api_instance.list_instance_groups(id, limit=limit, cursor=cursor)
        print("The response of GroupsApi->list_instance_groups:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GroupsApi->list_instance_groups: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **limit** | **int**|  | [optional] [default to 100]
 **cursor** | **str**|  | [optional] 

### Return type

[**ListInstanceGroups200Response**](ListInstanceGroups200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Groups list |  -  |
**400** | Not supported |  -  |
**404** | Instance not found |  -  |
**500** | Groups fetch failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

