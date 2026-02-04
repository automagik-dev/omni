# omni_generated.DeadLettersApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**abandon_dead_letter**](DeadLettersApi.md#abandon_dead_letter) | **POST** /dead-letters/{id}/abandon | Abandon dead letter
[**get_dead_letter**](DeadLettersApi.md#get_dead_letter) | **GET** /dead-letters/{id} | Get dead letter
[**get_dead_letter_stats**](DeadLettersApi.md#get_dead_letter_stats) | **GET** /dead-letters/stats | Get dead letter stats
[**list_dead_letters**](DeadLettersApi.md#list_dead_letters) | **GET** /dead-letters | List dead letters
[**resolve_dead_letter**](DeadLettersApi.md#resolve_dead_letter) | **POST** /dead-letters/{id}/resolve | Resolve dead letter
[**retry_dead_letter**](DeadLettersApi.md#retry_dead_letter) | **POST** /dead-letters/{id}/retry | Retry dead letter


# **abandon_dead_letter**
> GetDeadLetter200Response abandon_dead_letter(id)

Abandon dead letter

Give up on auto-retrying a dead letter.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_dead_letter200_response import GetDeadLetter200Response
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
    api_instance = omni_generated.DeadLettersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Abandon dead letter
        api_response = api_instance.abandon_dead_letter(id)
        print("The response of DeadLettersApi->abandon_dead_letter:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->abandon_dead_letter: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Abandoned |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_dead_letter**
> GetDeadLetter200Response get_dead_letter(id)

Get dead letter

Get details of a specific dead letter with payload.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_dead_letter200_response import GetDeadLetter200Response
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
    api_instance = omni_generated.DeadLettersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get dead letter
        api_response = api_instance.get_dead_letter(id)
        print("The response of DeadLettersApi->get_dead_letter:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->get_dead_letter: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Dead letter details |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_dead_letter_stats**
> GetDeadLetterStats200Response get_dead_letter_stats()

Get dead letter stats

Get statistics about dead letters.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_dead_letter_stats200_response import GetDeadLetterStats200Response
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
    api_instance = omni_generated.DeadLettersApi(api_client)

    try:
        # Get dead letter stats
        api_response = api_instance.get_dead_letter_stats()
        print("The response of DeadLettersApi->get_dead_letter_stats:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->get_dead_letter_stats: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetDeadLetterStats200Response**](GetDeadLetterStats200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Statistics |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_dead_letters**
> ListDeadLetters200Response list_dead_letters(status=status, event_type=event_type, since=since, until=until, limit=limit, cursor=cursor)

List dead letters

Get dead letters with filtering.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_dead_letters200_response import ListDeadLetters200Response
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
    api_instance = omni_generated.DeadLettersApi(api_client)
    status = 'status_example' # str |  (optional)
    event_type = 'event_type_example' # str |  (optional)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    until = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # List dead letters
        api_response = api_instance.list_dead_letters(status=status, event_type=event_type, since=since, until=until, limit=limit, cursor=cursor)
        print("The response of DeadLettersApi->list_dead_letters:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->list_dead_letters: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **status** | **str**|  | [optional] 
 **event_type** | **str**|  | [optional] 
 **since** | **datetime**|  | [optional] 
 **until** | **datetime**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**ListDeadLetters200Response**](ListDeadLetters200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of dead letters |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **resolve_dead_letter**
> GetDeadLetter200Response resolve_dead_letter(id, resolve_dead_letter_request=resolve_dead_letter_request)

Resolve dead letter

Mark a dead letter as resolved with a note.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_dead_letter200_response import GetDeadLetter200Response
from omni_generated.models.resolve_dead_letter_request import ResolveDeadLetterRequest
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
    api_instance = omni_generated.DeadLettersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    resolve_dead_letter_request = omni_generated.ResolveDeadLetterRequest() # ResolveDeadLetterRequest |  (optional)

    try:
        # Resolve dead letter
        api_response = api_instance.resolve_dead_letter(id, resolve_dead_letter_request=resolve_dead_letter_request)
        print("The response of DeadLettersApi->resolve_dead_letter:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->resolve_dead_letter: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **resolve_dead_letter_request** | [**ResolveDeadLetterRequest**](ResolveDeadLetterRequest.md)|  | [optional] 

### Return type

[**GetDeadLetter200Response**](GetDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Resolved |  -  |
**404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **retry_dead_letter**
> RetryDeadLetter200Response retry_dead_letter(id)

Retry dead letter

Manually retry a dead letter.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.retry_dead_letter200_response import RetryDeadLetter200Response
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
    api_instance = omni_generated.DeadLettersApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Retry dead letter
        api_response = api_instance.retry_dead_letter(id)
        print("The response of DeadLettersApi->retry_dead_letter:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeadLettersApi->retry_dead_letter: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**RetryDeadLetter200Response**](RetryDeadLetter200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Retry result |  -  |
**400** | Retry failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

