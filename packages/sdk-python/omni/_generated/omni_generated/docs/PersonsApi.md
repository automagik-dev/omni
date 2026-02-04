# omni_generated.PersonsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_person**](PersonsApi.md#get_person) | **GET** /persons/{id} | Get person by ID
[**get_person_presence**](PersonsApi.md#get_person_presence) | **GET** /persons/{id}/presence | Get person presence
[**get_person_timeline_by_id**](PersonsApi.md#get_person_timeline_by_id) | **GET** /persons/{id}/timeline | Get person timeline
[**link_identities**](PersonsApi.md#link_identities) | **POST** /persons/link | Link identities
[**merge_persons**](PersonsApi.md#merge_persons) | **POST** /persons/merge | Merge persons
[**search_persons**](PersonsApi.md#search_persons) | **GET** /persons | Search persons
[**unlink_identity**](PersonsApi.md#unlink_identity) | **POST** /persons/unlink | Unlink identity


# **get_person**
> GetPerson200Response get_person(id)

Get person by ID

Get details of a specific person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_person200_response import GetPerson200Response
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
    api_instance = omni_generated.PersonsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get person by ID
        api_response = api_instance.get_person(id)
        print("The response of PersonsApi->get_person:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->get_person: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetPerson200Response**](GetPerson200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Person details |  -  |
**404** | Person not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_person_presence**
> GetPersonPresence200Response get_person_presence(id)

Get person presence

Get all identities and presence information for a person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_person_presence200_response import GetPersonPresence200Response
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
    api_instance = omni_generated.PersonsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get person presence
        api_response = api_instance.get_person_presence(id)
        print("The response of PersonsApi->get_person_presence:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->get_person_presence: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetPersonPresence200Response**](GetPersonPresence200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Presence data |  -  |
**404** | Person not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_person_timeline_by_id**
> GetPersonTimelineById200Response get_person_timeline_by_id(id, channels=channels, since=since, until=until, limit=limit, cursor=cursor)

Get person timeline

Get cross-channel message timeline for a person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_person_timeline_by_id200_response import GetPersonTimelineById200Response
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
    api_instance = omni_generated.PersonsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    channels = 'channels_example' # str |  (optional)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    until = '2013-10-20T19:20:30+01:00' # datetime |  (optional)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # Get person timeline
        api_response = api_instance.get_person_timeline_by_id(id, channels=channels, since=since, until=until, limit=limit, cursor=cursor)
        print("The response of PersonsApi->get_person_timeline_by_id:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->get_person_timeline_by_id: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **channels** | **str**|  | [optional] 
 **since** | **datetime**|  | [optional] 
 **until** | **datetime**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**GetPersonTimelineById200Response**](GetPersonTimelineById200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Timeline events |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **link_identities**
> GetPerson200Response link_identities(link_identities_request=link_identities_request)

Link identities

Link two identities to the same person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_person200_response import GetPerson200Response
from omni_generated.models.link_identities_request import LinkIdentitiesRequest
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
    api_instance = omni_generated.PersonsApi(api_client)
    link_identities_request = omni_generated.LinkIdentitiesRequest() # LinkIdentitiesRequest |  (optional)

    try:
        # Link identities
        api_response = api_instance.link_identities(link_identities_request=link_identities_request)
        print("The response of PersonsApi->link_identities:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->link_identities: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **link_identities_request** | [**LinkIdentitiesRequest**](LinkIdentitiesRequest.md)|  | [optional] 

### Return type

[**GetPerson200Response**](GetPerson200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identities linked |  -  |
**404** | Identity not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **merge_persons**
> MergePersons200Response merge_persons(merge_persons_request=merge_persons_request)

Merge persons

Merge two persons into one.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.merge_persons200_response import MergePersons200Response
from omni_generated.models.merge_persons_request import MergePersonsRequest
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
    api_instance = omni_generated.PersonsApi(api_client)
    merge_persons_request = omni_generated.MergePersonsRequest() # MergePersonsRequest |  (optional)

    try:
        # Merge persons
        api_response = api_instance.merge_persons(merge_persons_request=merge_persons_request)
        print("The response of PersonsApi->merge_persons:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->merge_persons: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **merge_persons_request** | [**MergePersonsRequest**](MergePersonsRequest.md)|  | [optional] 

### Return type

[**MergePersons200Response**](MergePersons200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Persons merged |  -  |
**404** | Person not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **search_persons**
> SearchPersons200Response search_persons(search, limit=limit)

Search persons

Search for persons by name, email, or phone.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.search_persons200_response import SearchPersons200Response
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
    api_instance = omni_generated.PersonsApi(api_client)
    search = 'search_example' # str | 
    limit = 20 # int |  (optional) (default to 20)

    try:
        # Search persons
        api_response = api_instance.search_persons(search, limit=limit)
        print("The response of PersonsApi->search_persons:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->search_persons: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **search** | **str**|  | 
 **limit** | **int**|  | [optional] [default to 20]

### Return type

[**SearchPersons200Response**](SearchPersons200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Search results |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **unlink_identity**
> UnlinkIdentity200Response unlink_identity(unlink_identity_request=unlink_identity_request)

Unlink identity

Unlink an identity from its person.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.unlink_identity200_response import UnlinkIdentity200Response
from omni_generated.models.unlink_identity_request import UnlinkIdentityRequest
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
    api_instance = omni_generated.PersonsApi(api_client)
    unlink_identity_request = omni_generated.UnlinkIdentityRequest() # UnlinkIdentityRequest |  (optional)

    try:
        # Unlink identity
        api_response = api_instance.unlink_identity(unlink_identity_request=unlink_identity_request)
        print("The response of PersonsApi->unlink_identity:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling PersonsApi->unlink_identity: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **unlink_identity_request** | [**UnlinkIdentityRequest**](UnlinkIdentityRequest.md)|  | [optional] 

### Return type

[**UnlinkIdentity200Response**](UnlinkIdentity200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identity unlinked |  -  |
**404** | Identity not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

