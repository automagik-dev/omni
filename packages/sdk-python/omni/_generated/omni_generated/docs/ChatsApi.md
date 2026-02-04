# omni_generated.ChatsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**mark_chat_read**](ChatsApi.md#mark_chat_read) | **POST** /chats/{id}/read | Mark entire chat as read


# **mark_chat_read**
> MarkMessageRead200Response mark_chat_read(id, mark_message_read_request=mark_message_read_request)

Mark entire chat as read

Mark all unread messages in a chat as read. WhatsApp only.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.mark_message_read200_response import MarkMessageRead200Response
from omni_generated.models.mark_message_read_request import MarkMessageReadRequest
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
    api_instance = omni_generated.ChatsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    mark_message_read_request = omni_generated.MarkMessageReadRequest() # MarkMessageReadRequest |  (optional)

    try:
        # Mark entire chat as read
        api_response = api_instance.mark_chat_read(id, mark_message_read_request=mark_message_read_request)
        print("The response of ChatsApi->mark_chat_read:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ChatsApi->mark_chat_read: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **mark_message_read_request** | [**MarkMessageReadRequest**](MarkMessageReadRequest.md)|  | [optional] 

### Return type

[**MarkMessageRead200Response**](MarkMessageRead200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Chat marked as read |  -  |
**400** | Validation error or capability not supported |  -  |
**404** | Chat not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

