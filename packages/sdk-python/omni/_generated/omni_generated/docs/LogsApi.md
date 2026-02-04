# omni_generated.LogsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_recent_logs**](LogsApi.md#get_recent_logs) | **GET** /logs/recent | Get recent logs
[**stream_logs**](LogsApi.md#stream_logs) | **GET** /logs/stream | Stream logs (SSE)


# **get_recent_logs**
> GetRecentLogs200Response get_recent_logs(modules=modules, level=level, limit=limit)

Get recent logs

Get recent log entries from the in-memory buffer.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_recent_logs200_response import GetRecentLogs200Response
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
    api_instance = omni_generated.LogsApi(api_client)
    modules = 'modules_example' # str |  (optional)
    level = info # str |  (optional) (default to info)
    limit = 100 # int |  (optional) (default to 100)

    try:
        # Get recent logs
        api_response = api_instance.get_recent_logs(modules=modules, level=level, limit=limit)
        print("The response of LogsApi->get_recent_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling LogsApi->get_recent_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **modules** | **str**|  | [optional] 
 **level** | **str**|  | [optional] [default to info]
 **limit** | **int**|  | [optional] [default to 100]

### Return type

[**GetRecentLogs200Response**](GetRecentLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Recent log entries |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **stream_logs**
> str stream_logs(modules=modules, level=level)

Stream logs (SSE)

Stream logs in real-time via Server-Sent Events. Heartbeat sent every 30 seconds.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
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
    api_instance = omni_generated.LogsApi(api_client)
    modules = 'modules_example' # str |  (optional)
    level = info # str |  (optional) (default to info)

    try:
        # Stream logs (SSE)
        api_response = api_instance.stream_logs(modules=modules, level=level)
        print("The response of LogsApi->stream_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling LogsApi->stream_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **modules** | **str**|  | [optional] 
 **level** | **str**|  | [optional] [default to info]

### Return type

**str**

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: text/event-stream

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | SSE stream of log entries |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

