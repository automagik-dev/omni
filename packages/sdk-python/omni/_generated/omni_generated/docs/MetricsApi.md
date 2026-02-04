# omni_generated.MetricsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_metrics**](MetricsApi.md#get_metrics) | **GET** /metrics | Get Prometheus metrics


# **get_metrics**
> str get_metrics()

Get Prometheus metrics

Get metrics in Prometheus text format (default) or JSON format.

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
    api_instance = omni_generated.MetricsApi(api_client)

    try:
        # Get Prometheus metrics
        api_response = api_instance.get_metrics()
        print("The response of MetricsApi->get_metrics:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling MetricsApi->get_metrics: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**str**

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: text/plain, application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Metrics in Prometheus or JSON format |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

