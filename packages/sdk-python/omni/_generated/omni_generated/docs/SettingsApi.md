# omni_generated.SettingsApi

All URIs are relative to */api/v2*

Method | HTTP request | Description
------------- | ------------- | -------------
[**bulk_update_settings**](SettingsApi.md#bulk_update_settings) | **PATCH** /settings | Bulk update settings
[**delete_setting**](SettingsApi.md#delete_setting) | **DELETE** /settings/{key} | Delete setting
[**get_setting**](SettingsApi.md#get_setting) | **GET** /settings/{key} | Get setting
[**get_setting_history**](SettingsApi.md#get_setting_history) | **GET** /settings/{key}/history | Get setting history
[**list_settings**](SettingsApi.md#list_settings) | **GET** /settings | List settings
[**set_setting**](SettingsApi.md#set_setting) | **PUT** /settings/{key} | Set setting


# **bulk_update_settings**
> ListSettings200Response bulk_update_settings(bulk_update_settings_request=bulk_update_settings_request)

Bulk update settings

Update multiple settings at once.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.bulk_update_settings_request import BulkUpdateSettingsRequest
from omni_generated.models.list_settings200_response import ListSettings200Response
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
    api_instance = omni_generated.SettingsApi(api_client)
    bulk_update_settings_request = omni_generated.BulkUpdateSettingsRequest() # BulkUpdateSettingsRequest |  (optional)

    try:
        # Bulk update settings
        api_response = api_instance.bulk_update_settings(bulk_update_settings_request=bulk_update_settings_request)
        print("The response of SettingsApi->bulk_update_settings:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->bulk_update_settings: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **bulk_update_settings_request** | [**BulkUpdateSettingsRequest**](BulkUpdateSettingsRequest.md)|  | [optional] 

### Return type

[**ListSettings200Response**](ListSettings200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Settings updated |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_setting**
> DeleteInstance200Response delete_setting(key)

Delete setting

Delete a setting.

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
    api_instance = omni_generated.SettingsApi(api_client)
    key = 'key_example' # str | 

    try:
        # Delete setting
        api_response = api_instance.delete_setting(key)
        print("The response of SettingsApi->delete_setting:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->delete_setting: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **key** | **str**|  | 

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
**200** | Setting deleted |  -  |
**404** | Setting not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_setting**
> GetSetting200Response get_setting(key)

Get setting

Get a specific setting by key.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_setting200_response import GetSetting200Response
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
    api_instance = omni_generated.SettingsApi(api_client)
    key = 'key_example' # str | 

    try:
        # Get setting
        api_response = api_instance.get_setting(key)
        print("The response of SettingsApi->get_setting:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->get_setting: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **key** | **str**|  | 

### Return type

[**GetSetting200Response**](GetSetting200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Setting details |  -  |
**404** | Setting not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_setting_history**
> GetSettingHistory200Response get_setting_history(key, limit=limit, since=since)

Get setting history

Get change history for a setting.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_setting_history200_response import GetSettingHistory200Response
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
    api_instance = omni_generated.SettingsApi(api_client)
    key = 'key_example' # str | 
    limit = 50 # int |  (optional) (default to 50)
    since = '2013-10-20T19:20:30+01:00' # datetime |  (optional)

    try:
        # Get setting history
        api_response = api_instance.get_setting_history(key, limit=limit, since=since)
        print("The response of SettingsApi->get_setting_history:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->get_setting_history: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **key** | **str**|  | 
 **limit** | **int**|  | [optional] [default to 50]
 **since** | **datetime**|  | [optional] 

### Return type

[**GetSettingHistory200Response**](GetSettingHistory200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Setting history |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_settings**
> ListSettings200Response list_settings(category=category)

List settings

Get all settings. Secret values are masked.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.list_settings200_response import ListSettings200Response
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
    api_instance = omni_generated.SettingsApi(api_client)
    category = 'category_example' # str |  (optional)

    try:
        # List settings
        api_response = api_instance.list_settings(category=category)
        print("The response of SettingsApi->list_settings:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->list_settings: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **category** | **str**|  | [optional] 

### Return type

[**ListSettings200Response**](ListSettings200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of settings |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **set_setting**
> GetSetting200Response set_setting(key, set_setting_request=set_setting_request)

Set setting

Set a setting value.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import omni_generated
from omni_generated.models.get_setting200_response import GetSetting200Response
from omni_generated.models.set_setting_request import SetSettingRequest
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
    api_instance = omni_generated.SettingsApi(api_client)
    key = 'key_example' # str | 
    set_setting_request = omni_generated.SetSettingRequest() # SetSettingRequest |  (optional)

    try:
        # Set setting
        api_response = api_instance.set_setting(key, set_setting_request=set_setting_request)
        print("The response of SettingsApi->set_setting:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SettingsApi->set_setting: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **key** | **str**|  | 
 **set_setting_request** | [**SetSettingRequest**](SetSettingRequest.md)|  | [optional] 

### Return type

[**GetSetting200Response**](GetSetting200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Setting updated |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

