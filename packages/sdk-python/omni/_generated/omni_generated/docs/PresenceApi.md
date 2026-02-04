# omni_generated.PresenceApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**send_presence**](PresenceApi.md#send_presence) | **POST** /messages/send/presence | Send presence indicator


# **send_presence**
> SendPresence200Response send_presence(send_presence_request=send_presence_request)

Send presence indicator

Send typing/recording indicator in a chat. Auto-pauses after duration. WhatsApp supports typing, recording, paused. Discord only supports typing.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.send_presence200_response import SendPresence200Response
from omni_generated.models.send_presence_request import SendPresenceRequest
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
    api_instance = omni_generated.PresenceApi(api_client)
    send_presence_request = omni_generated.SendPresenceRequest() # SendPresenceRequest |  (optional)

    try:
        # Send presence indicator
        api_response = api_instance.send_presence(send_presence_request=send_presence_request)
        print("The response of PresenceApi->send_presence:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PresenceApi->send_presence: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **send_presence_request** | [**SendPresenceRequest**](SendPresenceRequest.md)|  | [optional] 

### Return type

[**SendPresence200Response**](SendPresence200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Presence sent |  -  |
**400** | Validation error or capability not supported |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

