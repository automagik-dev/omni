# omni_generated.SystemApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_health**](SystemApi.md#get_health) | **GET** /health | Health check
[**get_info**](SystemApi.md#get_info) | **GET** /info | System info
[**get_internal_health**](SystemApi.md#get_internal_health) | **GET** /_internal/health | Internal health check


# **get_health**
> GetHealth200Response get_health()

Health check

Check the health status of the API and its dependencies.

### Example


```python
import omni_generated
from omni_generated.models.get_health200_response import GetHealth200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)


# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.SystemApi(api_client)

    try:
        # Health check
        api_response = api_instance.get_health()
        print("The response of SystemApi->get_health:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_health: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetHealth200Response**](GetHealth200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | System is healthy |  -  |
**503** | System is unhealthy or degraded |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_info**
> GetInfo200Response get_info()

System info

Get system information and basic statistics.

### Example


```python
import omni_generated
from omni_generated.models.get_info200_response import GetInfo200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)


# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.SystemApi(api_client)

    try:
        # System info
        api_response = api_instance.get_info()
        print("The response of SystemApi->get_info:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_info: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetInfo200Response**](GetInfo200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | System information |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_internal_health**
> GetInternalHealth200Response get_internal_health()

Internal health check

Detailed health information for internal monitoring. Only accessible from localhost.

### Example


```python
import omni_generated
from omni_generated.models.get_internal_health200_response import GetInternalHealth200Response
from omni_generated.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to /api/v2
# See configuration.py for a list of all supported configuration parameters.
configuration = omni_generated.Configuration(
    host = "/api/v2"
)


# Enter a context with an instance of the API client
with omni_generated.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = omni_generated.SystemApi(api_client)

    try:
        # Internal health check
        api_response = api_instance.get_internal_health()
        print("The response of SystemApi->get_internal_health:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_internal_health: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetInternalHealth200Response**](GetInternalHealth200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Internal health status |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

