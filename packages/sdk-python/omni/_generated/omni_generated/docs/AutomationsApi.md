# omni_generated.AutomationsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_automation**](AutomationsApi.md#create_automation) | **POST** /automations | Create automation
[**delete_automation**](AutomationsApi.md#delete_automation) | **DELETE** /automations/{id} | Delete automation
[**disable_automation**](AutomationsApi.md#disable_automation) | **POST** /automations/{id}/disable | Disable automation
[**enable_automation**](AutomationsApi.md#enable_automation) | **POST** /automations/{id}/enable | Enable automation
[**execute_automation**](AutomationsApi.md#execute_automation) | **POST** /automations/{id}/execute | Execute automation
[**get_automation**](AutomationsApi.md#get_automation) | **GET** /automations/{id} | Get automation
[**get_automation_logs**](AutomationsApi.md#get_automation_logs) | **GET** /automations/{id}/logs | Get automation logs
[**get_automation_metrics**](AutomationsApi.md#get_automation_metrics) | **GET** /automation-metrics | Get automation metrics
[**list_automations**](AutomationsApi.md#list_automations) | **GET** /automations | List automations
[**search_automation_logs**](AutomationsApi.md#search_automation_logs) | **GET** /automation-logs | Search automation logs
[**test_automation**](AutomationsApi.md#test_automation) | **POST** /automations/{id}/test | Test automation
[**update_automation**](AutomationsApi.md#update_automation) | **PATCH** /automations/{id} | Update automation


# **create_automation**
> CreateAutomation201Response create_automation(create_automation_request=create_automation_request)

Create automation

Create a new automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_automation201_response import CreateAutomation201Response
from omni_generated.models.create_automation_request import CreateAutomationRequest
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
    api_instance = omni_generated.AutomationsApi(api_client)
    create_automation_request = omni_generated.CreateAutomationRequest() # CreateAutomationRequest |  (optional)

    try:
        # Create automation
        api_response = api_instance.create_automation(create_automation_request=create_automation_request)
        print("The response of AutomationsApi->create_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->create_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_automation_request** | [**CreateAutomationRequest**](CreateAutomationRequest.md)|  | [optional] 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Created |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_automation**
> DeleteInstance200Response delete_automation(id)

Delete automation

Delete an automation.

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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Delete automation
        api_response = api_instance.delete_automation(id)
        print("The response of AutomationsApi->delete_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->delete_automation: %s\n" % e)
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
**200** | Deleted |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **disable_automation**
> CreateAutomation201Response disable_automation(id)

Disable automation

Disable an automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_automation201_response import CreateAutomation201Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Disable automation
        api_response = api_instance.disable_automation(id)
        print("The response of AutomationsApi->disable_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->disable_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Disabled |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **enable_automation**
> CreateAutomation201Response enable_automation(id)

Enable automation

Enable an automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_automation201_response import CreateAutomation201Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Enable automation
        api_response = api_instance.enable_automation(id)
        print("The response of AutomationsApi->enable_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->enable_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Enabled |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execute_automation**
> ExecuteAutomation200Response execute_automation(id, test_automation_request=test_automation_request)

Execute automation

Execute automation with a provided event payload. Actually runs the actions (not a dry run).

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.execute_automation200_response import ExecuteAutomation200Response
from omni_generated.models.test_automation_request import TestAutomationRequest
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    test_automation_request = omni_generated.TestAutomationRequest() # TestAutomationRequest |  (optional)

    try:
        # Execute automation
        api_response = api_instance.execute_automation(id, test_automation_request=test_automation_request)
        print("The response of AutomationsApi->execute_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->execute_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **test_automation_request** | [**TestAutomationRequest**](TestAutomationRequest.md)|  | [optional] 

### Return type

[**ExecuteAutomation200Response**](ExecuteAutomation200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Execution result |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_automation**
> CreateAutomation201Response get_automation(id)

Get automation

Get details of a specific automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_automation201_response import CreateAutomation201Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get automation
        api_response = api_instance.get_automation(id)
        print("The response of AutomationsApi->get_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->get_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Automation details |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_automation_logs**
> GetAutomationLogs200Response get_automation_logs(id, limit=limit, cursor=cursor)

Get automation logs

Get execution logs for an automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_automation_logs200_response import GetAutomationLogs200Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # Get automation logs
        api_response = api_instance.get_automation_logs(id, limit=limit, cursor=cursor)
        print("The response of AutomationsApi->get_automation_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->get_automation_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**GetAutomationLogs200Response**](GetAutomationLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Logs |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_automation_metrics**
> GetAutomationMetrics200Response get_automation_metrics()

Get automation metrics

Get automation engine metrics.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_automation_metrics200_response import GetAutomationMetrics200Response
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
    api_instance = omni_generated.AutomationsApi(api_client)

    try:
        # Get automation metrics
        api_response = api_instance.get_automation_metrics()
        print("The response of AutomationsApi->get_automation_metrics:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->get_automation_metrics: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetAutomationMetrics200Response**](GetAutomationMetrics200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Metrics |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_automations**
> ListAutomations200Response list_automations(enabled=enabled)

List automations

Get all automations.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_automations200_response import ListAutomations200Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    enabled = True # bool |  (optional)

    try:
        # List automations
        api_response = api_instance.list_automations(enabled=enabled)
        print("The response of AutomationsApi->list_automations:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->list_automations: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **enabled** | **bool**|  | [optional] 

### Return type

[**ListAutomations200Response**](ListAutomations200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of automations |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **search_automation_logs**
> GetAutomationLogs200Response search_automation_logs(limit=limit, cursor=cursor, status=status, event_type=event_type, automation_id=automation_id)

Search automation logs

Search execution logs across automations.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_automation_logs200_response import GetAutomationLogs200Response
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
    api_instance = omni_generated.AutomationsApi(api_client)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)
    status = 'status_example' # str |  (optional)
    event_type = 'event_type_example' # str |  (optional)
    automation_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)

    try:
        # Search automation logs
        api_response = api_instance.search_automation_logs(limit=limit, cursor=cursor, status=status, event_type=event_type, automation_id=automation_id)
        print("The response of AutomationsApi->search_automation_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->search_automation_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 
 **status** | **str**|  | [optional] 
 **event_type** | **str**|  | [optional] 
 **automation_id** | **UUID**|  | [optional] 

### Return type

[**GetAutomationLogs200Response**](GetAutomationLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Logs |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **test_automation**
> TestAutomation200Response test_automation(id, test_automation_request=test_automation_request)

Test automation

Test automation against a sample event (dry run).

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.test_automation200_response import TestAutomation200Response
from omni_generated.models.test_automation_request import TestAutomationRequest
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    test_automation_request = omni_generated.TestAutomationRequest() # TestAutomationRequest |  (optional)

    try:
        # Test automation
        api_response = api_instance.test_automation(id, test_automation_request=test_automation_request)
        print("The response of AutomationsApi->test_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->test_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **test_automation_request** | [**TestAutomationRequest**](TestAutomationRequest.md)|  | [optional] 

### Return type

[**TestAutomation200Response**](TestAutomation200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Test result |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_automation**
> CreateAutomation201Response update_automation(id, update_automation_request=update_automation_request)

Update automation

Update an existing automation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_automation201_response import CreateAutomation201Response
from omni_generated.models.update_automation_request import UpdateAutomationRequest
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
    api_instance = omni_generated.AutomationsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    update_automation_request = omni_generated.UpdateAutomationRequest() # UpdateAutomationRequest |  (optional)

    try:
        # Update automation
        api_response = api_instance.update_automation(id, update_automation_request=update_automation_request)
        print("The response of AutomationsApi->update_automation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AutomationsApi->update_automation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **update_automation_request** | [**UpdateAutomationRequest**](UpdateAutomationRequest.md)|  | [optional] 

### Return type

[**CreateAutomation201Response**](CreateAutomation201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Updated |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

