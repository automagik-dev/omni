# omni_generated.WebhooksApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_webhook_source**](WebhooksApi.md#create_webhook_source) | **POST** /webhook-sources | Create webhook source
[**delete_webhook_source**](WebhooksApi.md#delete_webhook_source) | **DELETE** /webhook-sources/{id} | Delete webhook source
[**get_webhook_source**](WebhooksApi.md#get_webhook_source) | **GET** /webhook-sources/{id} | Get webhook source
[**list_webhook_sources**](WebhooksApi.md#list_webhook_sources) | **GET** /webhook-sources | List webhook sources
[**receive_webhook**](WebhooksApi.md#receive_webhook) | **POST** /webhooks/{source} | Receive webhook
[**trigger_event**](WebhooksApi.md#trigger_event) | **POST** /events/trigger | Trigger custom event
[**update_webhook_source**](WebhooksApi.md#update_webhook_source) | **PATCH** /webhook-sources/{id} | Update webhook source


# **create_webhook_source**
> CreateWebhookSource201Response create_webhook_source(create_webhook_source_request=create_webhook_source_request)

Create webhook source

Create a new webhook source.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_webhook_source201_response import CreateWebhookSource201Response
from omni_generated.models.create_webhook_source_request import CreateWebhookSourceRequest
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
    api_instance = omni_generated.WebhooksApi(api_client)
    create_webhook_source_request = omni_generated.CreateWebhookSourceRequest() # CreateWebhookSourceRequest |  (optional)

    try:
        # Create webhook source
        api_response = api_instance.create_webhook_source(create_webhook_source_request=create_webhook_source_request)
        print("The response of WebhooksApi->create_webhook_source:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->create_webhook_source: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_webhook_source_request** | [**CreateWebhookSourceRequest**](CreateWebhookSourceRequest.md)|  | [optional] 

### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Source created |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_webhook_source**
> DeleteInstance200Response delete_webhook_source(id)

Delete webhook source

Delete a webhook source.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.delete_instance200_response import DeleteInstance200Response
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
    api_instance = omni_generated.WebhooksApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Delete webhook source
        api_response = api_instance.delete_webhook_source(id)
        print("The response of WebhooksApi->delete_webhook_source:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->delete_webhook_source: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**DeleteInstance200Response**](DeleteInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Source deleted |  -  |
**404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_webhook_source**
> CreateWebhookSource201Response get_webhook_source(id)

Get webhook source

Get details of a specific webhook source.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_webhook_source201_response import CreateWebhookSource201Response
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
    api_instance = omni_generated.WebhooksApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get webhook source
        api_response = api_instance.get_webhook_source(id)
        print("The response of WebhooksApi->get_webhook_source:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->get_webhook_source: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Source details |  -  |
**404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_webhook_sources**
> ListWebhookSources200Response list_webhook_sources(enabled=enabled)

List webhook sources

Get all configured webhook sources.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_webhook_sources200_response import ListWebhookSources200Response
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
    api_instance = omni_generated.WebhooksApi(api_client)
    enabled = True # bool |  (optional)

    try:
        # List webhook sources
        api_response = api_instance.list_webhook_sources(enabled=enabled)
        print("The response of WebhooksApi->list_webhook_sources:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->list_webhook_sources: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **enabled** | **bool**|  | [optional] 

### Return type

[**ListWebhookSources200Response**](ListWebhookSources200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of sources |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **receive_webhook**
> ReceiveWebhook200Response receive_webhook(source, request_body=request_body)

Receive webhook

Receive webhook from external system. Creates a custom event.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.receive_webhook200_response import ReceiveWebhook200Response
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
    api_instance = omni_generated.WebhooksApi(api_client)
    source = 'source_example' # str | 
    request_body = None # Dict[str, Optional[object]] |  (optional)

    try:
        # Receive webhook
        api_response = api_instance.receive_webhook(source, request_body=request_body)
        print("The response of WebhooksApi->receive_webhook:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->receive_webhook: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **source** | **str**|  | 
 **request_body** | [**Dict[str, Optional[object]]**](object.md)|  | [optional] 

### Return type

[**ReceiveWebhook200Response**](ReceiveWebhook200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Webhook received |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **trigger_event**
> ReceiveWebhook200Response trigger_event(trigger_event_request=trigger_event_request)

Trigger custom event

Manually trigger a custom event.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.receive_webhook200_response import ReceiveWebhook200Response
from omni_generated.models.trigger_event_request import TriggerEventRequest
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
    api_instance = omni_generated.WebhooksApi(api_client)
    trigger_event_request = omni_generated.TriggerEventRequest() # TriggerEventRequest |  (optional)

    try:
        # Trigger custom event
        api_response = api_instance.trigger_event(trigger_event_request=trigger_event_request)
        print("The response of WebhooksApi->trigger_event:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->trigger_event: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **trigger_event_request** | [**TriggerEventRequest**](TriggerEventRequest.md)|  | [optional] 

### Return type

[**ReceiveWebhook200Response**](ReceiveWebhook200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Event triggered |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_webhook_source**
> CreateWebhookSource201Response update_webhook_source(id, update_webhook_source_request=update_webhook_source_request)

Update webhook source

Update an existing webhook source.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_webhook_source201_response import CreateWebhookSource201Response
from omni_generated.models.update_webhook_source_request import UpdateWebhookSourceRequest
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
    api_instance = omni_generated.WebhooksApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    update_webhook_source_request = omni_generated.UpdateWebhookSourceRequest() # UpdateWebhookSourceRequest |  (optional)

    try:
        # Update webhook source
        api_response = api_instance.update_webhook_source(id, update_webhook_source_request=update_webhook_source_request)
        print("The response of WebhooksApi->update_webhook_source:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->update_webhook_source: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **update_webhook_source_request** | [**UpdateWebhookSourceRequest**](UpdateWebhookSourceRequest.md)|  | [optional] 

### Return type

[**CreateWebhookSource201Response**](CreateWebhookSource201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Source updated |  -  |
**404** | Source not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

