# omni_generated.PayloadsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**delete_event_payloads**](PayloadsApi.md#delete_event_payloads) | **DELETE** /events/{eventId}/payloads | Delete event payloads
[**get_event_payload_by_stage**](PayloadsApi.md#get_event_payload_by_stage) | **GET** /events/{eventId}/payloads/{stage} | Get event payload by stage
[**get_payload_stats**](PayloadsApi.md#get_payload_stats) | **GET** /payload-stats | Get payload stats
[**list_event_payloads**](PayloadsApi.md#list_event_payloads) | **GET** /events/{eventId}/payloads | List event payloads
[**list_payload_configs**](PayloadsApi.md#list_payload_configs) | **GET** /payload-config | List payload configs
[**update_payload_config**](PayloadsApi.md#update_payload_config) | **PUT** /payload-config/{eventType} | Update payload config


# **delete_event_payloads**
> RunScheduledOps200ResponseDataPayloadCleanup delete_event_payloads(event_id, delete_event_payloads_request=delete_event_payloads_request)

Delete event payloads

Soft-delete all payloads for an event.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.delete_event_payloads_request import DeleteEventPayloadsRequest
from omni_generated.models.run_scheduled_ops200_response_data_payload_cleanup import RunScheduledOps200ResponseDataPayloadCleanup
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
    api_instance = omni_generated.PayloadsApi(api_client)
    event_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    delete_event_payloads_request = omni_generated.DeleteEventPayloadsRequest() # DeleteEventPayloadsRequest |  (optional)

    try:
        # Delete event payloads
        api_response = api_instance.delete_event_payloads(event_id, delete_event_payloads_request=delete_event_payloads_request)
        print("The response of PayloadsApi->delete_event_payloads:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->delete_event_payloads: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **event_id** | **UUID**|  | 
 **delete_event_payloads_request** | [**DeleteEventPayloadsRequest**](DeleteEventPayloadsRequest.md)|  | [optional] 

### Return type

[**RunScheduledOps200ResponseDataPayloadCleanup**](RunScheduledOps200ResponseDataPayloadCleanup.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Deleted count |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_event_payload_by_stage**
> GetEventPayloadByStage200Response get_event_payload_by_stage(event_id, stage)

Get event payload by stage

Get a specific stage payload with decompressed data.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_event_payload_by_stage200_response import GetEventPayloadByStage200Response
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
    api_instance = omni_generated.PayloadsApi(api_client)
    event_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    stage = 'stage_example' # str | 

    try:
        # Get event payload by stage
        api_response = api_instance.get_event_payload_by_stage(event_id, stage)
        print("The response of PayloadsApi->get_event_payload_by_stage:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->get_event_payload_by_stage: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **event_id** | **UUID**|  | 
 **stage** | **str**|  | 

### Return type

[**GetEventPayloadByStage200Response**](GetEventPayloadByStage200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Payload with data |  -  |
**400** | Invalid stage |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_payload_stats**
> GetPayloadStats200Response get_payload_stats()

Get payload stats

Get payload storage statistics.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_payload_stats200_response import GetPayloadStats200Response
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
    api_instance = omni_generated.PayloadsApi(api_client)

    try:
        # Get payload stats
        api_response = api_instance.get_payload_stats()
        print("The response of PayloadsApi->get_payload_stats:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->get_payload_stats: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetPayloadStats200Response**](GetPayloadStats200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Stats |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_event_payloads**
> ListEventPayloads200Response list_event_payloads(event_id)

List event payloads

Get all payloads for an event (metadata only).

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_event_payloads200_response import ListEventPayloads200Response
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
    api_instance = omni_generated.PayloadsApi(api_client)
    event_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # List event payloads
        api_response = api_instance.list_event_payloads(event_id)
        print("The response of PayloadsApi->list_event_payloads:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->list_event_payloads: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **event_id** | **UUID**|  | 

### Return type

[**ListEventPayloads200Response**](ListEventPayloads200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Payload list |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_payload_configs**
> ListPayloadConfigs200Response list_payload_configs()

List payload configs

Get all payload storage configurations.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_payload_configs200_response import ListPayloadConfigs200Response
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
    api_instance = omni_generated.PayloadsApi(api_client)

    try:
        # List payload configs
        api_response = api_instance.list_payload_configs()
        print("The response of PayloadsApi->list_payload_configs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->list_payload_configs: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListPayloadConfigs200Response**](ListPayloadConfigs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Config list |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_payload_config**
> UpdatePayloadConfig200Response update_payload_config(event_type, update_payload_config_request=update_payload_config_request)

Update payload config

Update or create payload storage config for an event type.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.update_payload_config200_response import UpdatePayloadConfig200Response
from omni_generated.models.update_payload_config_request import UpdatePayloadConfigRequest
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
    api_instance = omni_generated.PayloadsApi(api_client)
    event_type = 'event_type_example' # str | 
    update_payload_config_request = omni_generated.UpdatePayloadConfigRequest() # UpdatePayloadConfigRequest |  (optional)

    try:
        # Update payload config
        api_response = api_instance.update_payload_config(event_type, update_payload_config_request=update_payload_config_request)
        print("The response of PayloadsApi->update_payload_config:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PayloadsApi->update_payload_config: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **event_type** | **str**|  | 
 **update_payload_config_request** | [**UpdatePayloadConfigRequest**](UpdatePayloadConfigRequest.md)|  | [optional] 

### Return type

[**UpdatePayloadConfig200Response**](UpdatePayloadConfig200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Updated config |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

