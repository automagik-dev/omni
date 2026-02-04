# omni_generated.ProvidersApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**check_provider_health**](ProvidersApi.md#check_provider_health) | **POST** /providers/{id}/health | Check provider health
[**create_provider**](ProvidersApi.md#create_provider) | **POST** /providers | Create provider
[**delete_provider**](ProvidersApi.md#delete_provider) | **DELETE** /providers/{id} | Delete provider
[**get_provider**](ProvidersApi.md#get_provider) | **GET** /providers/{id} | Get provider
[**list_provider_agents**](ProvidersApi.md#list_provider_agents) | **GET** /providers/{id}/agents | List provider agents
[**list_providers**](ProvidersApi.md#list_providers) | **GET** /providers | List providers
[**update_provider**](ProvidersApi.md#update_provider) | **PATCH** /providers/{id} | Update provider


# **check_provider_health**
> CheckProviderHealth200Response check_provider_health(id)

Check provider health

Check if provider is reachable and healthy.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.check_provider_health200_response import CheckProviderHealth200Response
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
    api_instance = omni_generated.ProvidersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Check provider health
        api_response = api_instance.check_provider_health(id)
        print("The response of ProvidersApi->check_provider_health:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->check_provider_health: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CheckProviderHealth200Response**](CheckProviderHealth200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Health check result |  -  |
**404** | Provider not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create_provider**
> CreateProvider201Response create_provider(create_provider_request=create_provider_request)

Create provider

Create a new agent provider.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_provider201_response import CreateProvider201Response
from omni_generated.models.create_provider_request import CreateProviderRequest
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
    api_instance = omni_generated.ProvidersApi(api_client)
    create_provider_request = omni_generated.CreateProviderRequest() # CreateProviderRequest |  (optional)

    try:
        # Create provider
        api_response = api_instance.create_provider(create_provider_request=create_provider_request)
        print("The response of ProvidersApi->create_provider:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->create_provider: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_provider_request** | [**CreateProviderRequest**](CreateProviderRequest.md)|  | [optional] 

### Return type

[**CreateProvider201Response**](CreateProvider201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Provider created |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_provider**
> DeleteInstance200Response delete_provider(id)

Delete provider

Delete an agent provider.

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
    api_instance = omni_generated.ProvidersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Delete provider
        api_response = api_instance.delete_provider(id)
        print("The response of ProvidersApi->delete_provider:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->delete_provider: %s\n" % e)
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
**200** | Provider deleted |  -  |
**404** | Provider not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_provider**
> CreateProvider201Response get_provider(id)

Get provider

Get details of a specific provider.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_provider201_response import CreateProvider201Response
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
    api_instance = omni_generated.ProvidersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get provider
        api_response = api_instance.get_provider(id)
        print("The response of ProvidersApi->get_provider:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->get_provider: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateProvider201Response**](CreateProvider201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Provider details |  -  |
**404** | Provider not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_provider_agents**
> ListProviderAgents200Response list_provider_agents(id)

List provider agents

List available agents from a provider.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_provider_agents200_response import ListProviderAgents200Response
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
    api_instance = omni_generated.ProvidersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # List provider agents
        api_response = api_instance.list_provider_agents(id)
        print("The response of ProvidersApi->list_provider_agents:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->list_provider_agents: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**ListProviderAgents200Response**](ListProviderAgents200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Agent list |  -  |
**404** | Provider not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_providers**
> ListProviders200Response list_providers(active=active)

List providers

Get all agent providers.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_providers200_response import ListProviders200Response
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
    api_instance = omni_generated.ProvidersApi(api_client)
    active = True # bool |  (optional)

    try:
        # List providers
        api_response = api_instance.list_providers(active=active)
        print("The response of ProvidersApi->list_providers:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->list_providers: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **active** | **bool**|  | [optional] 

### Return type

[**ListProviders200Response**](ListProviders200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of providers |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_provider**
> CreateProvider201Response update_provider(id, update_provider_request=update_provider_request)

Update provider

Update an existing provider.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_provider201_response import CreateProvider201Response
from omni_generated.models.update_provider_request import UpdateProviderRequest
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
    api_instance = omni_generated.ProvidersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    update_provider_request = omni_generated.UpdateProviderRequest() # UpdateProviderRequest |  (optional)

    try:
        # Update provider
        api_response = api_instance.update_provider(id, update_provider_request=update_provider_request)
        print("The response of ProvidersApi->update_provider:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ProvidersApi->update_provider: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **update_provider_request** | [**UpdateProviderRequest**](UpdateProviderRequest.md)|  | [optional] 

### Return type

[**CreateProvider201Response**](CreateProvider201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Provider updated |  -  |
**404** | Provider not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

