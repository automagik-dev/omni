# omni_generated.InstancesApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**connect_instance**](InstancesApi.md#connect_instance) | **POST** /instances/{id}/connect | Connect instance
[**create_instance**](InstancesApi.md#create_instance) | **POST** /instances | Create new instance
[**delete_instance**](InstancesApi.md#delete_instance) | **DELETE** /instances/{id} | Delete instance
[**disconnect_instance**](InstancesApi.md#disconnect_instance) | **POST** /instances/{id}/disconnect | Disconnect instance
[**get_instance**](InstancesApi.md#get_instance) | **GET** /instances/{id} | Get instance by ID
[**get_instance_qr**](InstancesApi.md#get_instance_qr) | **GET** /instances/{id}/qr | Get QR code for WhatsApp connection
[**get_instance_status**](InstancesApi.md#get_instance_status) | **GET** /instances/{id}/status | Get instance connection status
[**get_user_profile**](InstancesApi.md#get_user_profile) | **GET** /instances/{id}/users/{userId}/profile | Fetch user profile
[**list_instance_contacts**](InstancesApi.md#list_instance_contacts) | **GET** /instances/{id}/contacts | List contacts
[**list_instance_groups**](InstancesApi.md#list_instance_groups) | **GET** /instances/{id}/groups | List groups
[**list_instances**](InstancesApi.md#list_instances) | **GET** /instances | List all instances
[**list_supported_channels**](InstancesApi.md#list_supported_channels) | **GET** /instances/supported-channels | List supported channel types
[**logout_instance**](InstancesApi.md#logout_instance) | **POST** /instances/{id}/logout | Logout instance
[**request_pairing_code**](InstancesApi.md#request_pairing_code) | **POST** /instances/{id}/pair | Request pairing code
[**restart_instance**](InstancesApi.md#restart_instance) | **POST** /instances/{id}/restart | Restart instance
[**update_instance**](InstancesApi.md#update_instance) | **PATCH** /instances/{id} | Update instance


# **connect_instance**
> ConnectInstance200Response connect_instance(id, force_new_qr=force_new_qr, connect_instance_request=connect_instance_request)

Connect instance

Initiate connection for a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.connect_instance200_response import ConnectInstance200Response
from omni_generated.models.connect_instance_request import ConnectInstanceRequest
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    force_new_qr = 'force_new_qr_example' # str |  (optional)
    connect_instance_request = omni_generated.ConnectInstanceRequest() # ConnectInstanceRequest |  (optional)

    try:
        # Connect instance
        api_response = api_instance.connect_instance(id, force_new_qr=force_new_qr, connect_instance_request=connect_instance_request)
        print("The response of InstancesApi->connect_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->connect_instance: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **force_new_qr** | **str**|  | [optional] 
 **connect_instance_request** | [**ConnectInstanceRequest**](ConnectInstanceRequest.md)|  | [optional] 

### Return type

[**ConnectInstance200Response**](ConnectInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Connection initiated |  -  |
**400** | Plugin not found |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **create_instance**
> CreateInstance201Response create_instance(create_instance_request=create_instance_request)

Create new instance

Create a new channel instance. For Discord, a bot token is required.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_instance201_response import CreateInstance201Response
from omni_generated.models.create_instance_request import CreateInstanceRequest
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
    api_instance = omni_generated.InstancesApi(api_client)
    create_instance_request = omni_generated.CreateInstanceRequest() # CreateInstanceRequest |  (optional)

    try:
        # Create new instance
        api_response = api_instance.create_instance(create_instance_request=create_instance_request)
        print("The response of InstancesApi->create_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->create_instance: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_instance_request** | [**CreateInstanceRequest**](CreateInstanceRequest.md)|  | [optional] 

### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Instance created |  -  |
**400** | Validation error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_instance**
> DeleteInstance200Response delete_instance(id)

Delete instance

Delete a channel instance. This will disconnect the instance first.

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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Delete instance
        api_response = api_instance.delete_instance(id)
        print("The response of InstancesApi->delete_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->delete_instance: %s\n" % e)
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
**200** | Instance deleted |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **disconnect_instance**
> DeleteInstance200Response disconnect_instance(id)

Disconnect instance

Disconnect a channel instance while preserving session data.

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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Disconnect instance
        api_response = api_instance.disconnect_instance(id)
        print("The response of InstancesApi->disconnect_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->disconnect_instance: %s\n" % e)
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
**200** | Instance disconnected |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_instance**
> CreateInstance201Response get_instance(id)

Get instance by ID

Get details of a specific channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_instance201_response import CreateInstance201Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get instance by ID
        api_response = api_instance.get_instance(id)
        print("The response of InstancesApi->get_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->get_instance: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Instance details |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_instance_qr**
> GetInstanceQr200Response get_instance_qr(id)

Get QR code for WhatsApp connection

Get the QR code for connecting a WhatsApp instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_instance_qr200_response import GetInstanceQr200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get QR code for WhatsApp connection
        api_response = api_instance.get_instance_qr(id)
        print("The response of InstancesApi->get_instance_qr:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->get_instance_qr: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetInstanceQr200Response**](GetInstanceQr200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | QR code data |  -  |
**400** | Not a WhatsApp instance |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_instance_status**
> GetInstanceStatus200Response get_instance_status(id)

Get instance connection status

Get the current connection status of a channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_instance_status200_response import GetInstanceStatus200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get instance connection status
        api_response = api_instance.get_instance_status(id)
        print("The response of InstancesApi->get_instance_status:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->get_instance_status: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetInstanceStatus200Response**](GetInstanceStatus200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Instance status |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_user_profile**
> GetUserProfile200Response get_user_profile(id, user_id)

Fetch user profile

Fetch profile information for a specific user on this channel.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_user_profile200_response import GetUserProfile200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    user_id = 'user_id_example' # str | 

    try:
        # Fetch user profile
        api_response = api_instance.get_user_profile(id, user_id)
        print("The response of InstancesApi->get_user_profile:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->get_user_profile: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **user_id** | **str**|  | 

### Return type

[**GetUserProfile200Response**](GetUserProfile200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | User profile |  -  |
**400** | Not supported |  -  |
**404** | Instance not found |  -  |
**500** | Profile fetch failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_instance_contacts**
> ListInstanceContacts200Response list_instance_contacts(id, limit=limit, cursor=cursor, guild_id=guild_id)

List contacts

List contacts for an instance. For Discord, requires guildId query parameter.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_instance_contacts200_response import ListInstanceContacts200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    limit = 100 # int |  (optional) (default to 100)
    cursor = 'cursor_example' # str |  (optional)
    guild_id = 'guild_id_example' # str |  (optional)

    try:
        # List contacts
        api_response = api_instance.list_instance_contacts(id, limit=limit, cursor=cursor, guild_id=guild_id)
        print("The response of InstancesApi->list_instance_contacts:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->list_instance_contacts: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **limit** | **int**|  | [optional] [default to 100]
 **cursor** | **str**|  | [optional] 
 **guild_id** | **str**|  | [optional] 

### Return type

[**ListInstanceContacts200Response**](ListInstanceContacts200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Contacts list |  -  |
**400** | Not supported or missing guildId |  -  |
**404** | Instance not found |  -  |
**500** | Contacts fetch failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_instance_groups**
> ListInstanceGroups200Response list_instance_groups(id, limit=limit, cursor=cursor)

List groups

List groups the instance is participating in.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_instance_groups200_response import ListInstanceGroups200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    limit = 100 # int |  (optional) (default to 100)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # List groups
        api_response = api_instance.list_instance_groups(id, limit=limit, cursor=cursor)
        print("The response of InstancesApi->list_instance_groups:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->list_instance_groups: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **limit** | **int**|  | [optional] [default to 100]
 **cursor** | **str**|  | [optional] 

### Return type

[**ListInstanceGroups200Response**](ListInstanceGroups200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Groups list |  -  |
**400** | Not supported |  -  |
**404** | Instance not found |  -  |
**500** | Groups fetch failed |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_instances**
> ListInstances200Response list_instances(channel=channel, status=status, limit=limit, cursor=cursor)

List all instances

Get a paginated list of channel instances with optional filtering.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_instances200_response import ListInstances200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    channel = 'channel_example' # str |  (optional)
    status = 'status_example' # str |  (optional)
    limit = 50 # int |  (optional) (default to 50)
    cursor = 'cursor_example' # str |  (optional)

    try:
        # List all instances
        api_response = api_instance.list_instances(channel=channel, status=status, limit=limit, cursor=cursor)
        print("The response of InstancesApi->list_instances:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->list_instances: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **channel** | **str**|  | [optional] 
 **status** | **str**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]
 **cursor** | **str**|  | [optional] 

### Return type

[**ListInstances200Response**](ListInstances200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of instances |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_supported_channels**
> ListSupportedChannels200Response list_supported_channels()

List supported channel types

Get a list of all supported channel types with their capabilities.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_supported_channels200_response import ListSupportedChannels200Response
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
    api_instance = omni_generated.InstancesApi(api_client)

    try:
        # List supported channel types
        api_response = api_instance.list_supported_channels()
        print("The response of InstancesApi->list_supported_channels:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->list_supported_channels: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListSupportedChannels200Response**](ListSupportedChannels200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of supported channels |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **logout_instance**
> DeleteInstance200Response logout_instance(id)

Logout instance

Logout a channel instance, clearing all session data.

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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Logout instance
        api_response = api_instance.logout_instance(id)
        print("The response of InstancesApi->logout_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->logout_instance: %s\n" % e)
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
**200** | Session cleared |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **request_pairing_code**
> RequestPairingCode200Response request_pairing_code(id, request_pairing_code_request=request_pairing_code_request)

Request pairing code

Request a pairing code as an alternative to QR code scanning.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.request_pairing_code200_response import RequestPairingCode200Response
from omni_generated.models.request_pairing_code_request import RequestPairingCodeRequest
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    request_pairing_code_request = omni_generated.RequestPairingCodeRequest() # RequestPairingCodeRequest |  (optional)

    try:
        # Request pairing code
        api_response = api_instance.request_pairing_code(id, request_pairing_code_request=request_pairing_code_request)
        print("The response of InstancesApi->request_pairing_code:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->request_pairing_code: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **request_pairing_code_request** | [**RequestPairingCodeRequest**](RequestPairingCodeRequest.md)|  | [optional] 

### Return type

[**RequestPairingCode200Response**](RequestPairingCode200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Pairing code generated |  -  |
**400** | Invalid operation |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **restart_instance**
> ConnectInstance200Response restart_instance(id, force_new_qr=force_new_qr)

Restart instance

Restart a channel instance by disconnecting and reconnecting.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.connect_instance200_response import ConnectInstance200Response
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    force_new_qr = 'force_new_qr_example' # str |  (optional)

    try:
        # Restart instance
        api_response = api_instance.restart_instance(id, force_new_qr=force_new_qr)
        print("The response of InstancesApi->restart_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->restart_instance: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **force_new_qr** | **str**|  | [optional] 

### Return type

[**ConnectInstance200Response**](ConnectInstance200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Restart initiated |  -  |
**400** | Plugin not found |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **update_instance**
> CreateInstance201Response update_instance(id, update_instance_request=update_instance_request)

Update instance

Update an existing channel instance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.create_instance201_response import CreateInstance201Response
from omni_generated.models.update_instance_request import UpdateInstanceRequest
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
    api_instance = omni_generated.InstancesApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    update_instance_request = omni_generated.UpdateInstanceRequest() # UpdateInstanceRequest |  (optional)

    try:
        # Update instance
        api_response = api_instance.update_instance(id, update_instance_request=update_instance_request)
        print("The response of InstancesApi->update_instance:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling InstancesApi->update_instance: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **update_instance_request** | [**UpdateInstanceRequest**](UpdateInstanceRequest.md)|  | [optional] 

### Return type

[**CreateInstance201Response**](CreateInstance201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Instance updated |  -  |
**404** | Instance not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

